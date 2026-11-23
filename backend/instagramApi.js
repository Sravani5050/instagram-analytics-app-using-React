// Instagram Graph API client. This is a direct port of the Python
// instagram_api.py, carrying over every bug fix made during that app's
// debugging: correct metric names (views, not plays; account-level
// insights use a different valid-metric list than media-level), the
// views -> video_views key mapping, per-metric fallback so one bad
// metric doesn't zero out an entire post's insights, and full
// pagination via paging.next for "fetch all posts".
//
// IMPORTANT: this file only ever runs on the server. The access token
// never leaves this process -- routes in server.js only ever return
// the *data*, never the credentials themselves.

const METRIC_KEY_MAP = { views: "video_views" };

export class InstagramAPI {
  constructor({ baseUrl, accessToken, accountId, label } = {}) {
    this.baseUrl = baseUrl;
    this.accessToken = accessToken;
    this.accountId = accountId;
    this.label = label || null;
    this.lastError = null;
  }

  async _request(endpointOrUrl, params = {}) {
    this.lastError = null;
    try {
      let url;
      if (endpointOrUrl.startsWith("http://") || endpointOrUrl.startsWith("https://")) {
        // Pagination "next" URLs from Meta already carry every param
        // they need, including the access token -- don't re-append ours.
        url = new URL(endpointOrUrl);
      } else {
        url = new URL(`${this.baseUrl}/${endpointOrUrl}`);
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null) url.searchParams.set(k, v);
        }
        url.searchParams.set("access_token", this.accessToken);
      }

      const res = await fetch(url.toString());
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const detail = json?.error?.message
          ? `[${json.error.code ?? "?"}] ${json.error.message}`
          : `HTTP ${res.status}`;
        this.lastError = detail;
        return null;
      }
      return json;
    } catch (err) {
      this.lastError = err.message;
      return null;
    }
  }

  async validateToken() {
    const result = await this._request(this.accountId, { fields: "id,username" });
    return !!result;
  }

  async getAccountInfo() {
    return this._request(this.accountId, {
      fields: "id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website",
    });
  }

  async getAccountInsights(period = "day", since, until) {
    // Metric list updated for Graph API v22.0: 'profile_views' and
    // 'website_clicks' were deprecated by Meta and folded into a
    // single unified 'views' metric (same consolidation that hit
    // media-level insights earlier in this project -- 'plays' became
    // 'views' there too).
    //
    // 'follower_count' doesn't support metric_type=total_value --
    // Meta silently drops it from a combined request instead of
    // erroring, so it's fetched separately below and summed from its
    // daily values instead.
    const totalValueMetrics = ["reach", "views", "accounts_engaged", "total_interactions"];

    const params = { metric: totalValueMetrics.join(","), period };
    // metric_type=total_value is required to get a real aggregated
    // total across a since/until window. Without it, Meta doesn't
    // reliably return the full daily series for the range requested
    // (in testing, period=day + since/until alone silently returned
    // only the most recent 2 days regardless of the window asked for).
    // Meta still requires 'period' to be present even in this mode
    // (confirmed by testing -- omitting it errors with "[100] For
    // field 'insights': The parameter period is required").
    if (since && until) {
      params.metric_type = "total_value";
      params.since = since;
      params.until = until;
    }

    let result = await this._request(`${this.accountId}/insights`, params);

    if (!result) {
      // One unsupported/failing metric shouldn't blank out the rest --
      // retry individually and merge whatever succeeds (same pattern
      // used for per-post insights).
      const merged = { data: [] };
      for (const metric of totalValueMetrics) {
        const single = await this._request(`${this.accountId}/insights`, { ...params, metric });
        if (single?.data) merged.data.push(...single.data);
      }
      result = merged.data.length ? merged : null;
    }

    // follower_count: separate request, plain period=day + since/until
    // (no metric_type), summing the daily values ourselves.
    const followerParams = { metric: "follower_count", period };
    if (since) followerParams.since = since;
    if (until) followerParams.until = until;
    const followerResult = await this._request(`${this.accountId}/insights`, followerParams);
    if (followerResult?.data) {
      if (!result) result = { data: [] };
      result.data.push(...followerResult.data);
    }

    if (!result?.data) return result;

    // Normalize both possible response shapes into a single
    // { values: [{ value }] } shape the rest of the app expects:
    //  - metric_type=total_value responses use `total_value: { value }`
    //  - plain period=day responses use `values: [{ value, end_time }, ...]`
    //    (possibly several days -- sum them into one total).
    for (const metric of result.data) {
      if (metric.total_value) {
        metric.values = [{ value: metric.total_value.value || 0 }];
      } else if (Array.isArray(metric.values) && metric.values.length > 1) {
        const total = metric.values.reduce((sum, v) => sum + (v.value || 0), 0);
        metric.values = [{ value: total }];
      }
    }

    return result;
  }

  async getAccountInsightsDaily(since, until) {
    // For an actual per-day trend (not one aggregated total). Meta's
    // documented parameter for this is metric_type=time_series --
    // untested in this project until now, since every prior attempt
    // used total_value (aggregated) or omitted metric_type entirely
    // (which we found silently truncates to only the 2 most recent
    // days regardless of the since/until range requested).
    //
    // Combining multiple metrics in one time_series request turned out
    // to silently drop everything after the first metric (Meta returns
    // 200 with only 'reach' present, no error) -- same class of issue
    // as follower_count getting dropped from the total_value request
    // earlier. Fetching each metric in its own request avoids that.
    const metrics = ["reach", "total_interactions", "accounts_engaged"];
    const merged = { data: [], _errors: {} };
    for (const metric of metrics) {
      const params = { metric, period: "day", metric_type: "time_series", since, until };
      const single = await this._request(`${this.accountId}/insights`, params);
      if (single?.data?.length) {
        merged.data.push(...single.data);
      } else if (single?.data) {
        // Request succeeded (200 OK) but came back with an empty data
        // array -- previously this was silently treated as success
        // since `single?.data` (even []) is truthy in JS. That bug is
        // why total_interactions/accounts_engaged were vanishing with
        // no visible error at all.
        merged._errors[metric] = "Meta returned 200 OK but an empty data array (metric likely doesn't support time_series here)";
      } else {
        merged._errors[metric] = this.lastError || "unknown error";
      }
    }
    return merged.data.length || Object.keys(merged._errors).length ? merged : null;
  }

  async getMediaInsights(mediaId, mediaType) {
    const isReel = mediaType === "VIDEO" || mediaType === "REELS";
    const metrics = isReel
      ? ["reach", "saved", "shares", "views", "total_interactions"]
      : ["reach", "saved", "shares", "views"];

    let result = await this._request(`${mediaId}/insights`, { metric: metrics.join(",") });
    if (result) return result;

    // One bad metric shouldn't zero out the whole post -- retry each
    // metric individually and merge whatever succeeds.
    const merged = { data: [] };
    for (const metric of metrics) {
      const single = await this._request(`${mediaId}/insights`, { metric });
      if (single?.data) merged.data.push(...single.data);
    }
    return merged.data.length ? merged : null;
  }

  async getRecentMedia(limit = 25) {
    // limit=null fetches every post on the account, following
    // pagination as needed.
    const pageSize = limit ? Math.min(limit, 100) : 100;
    const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";

    let allItems = [];
    let nextCall = this.accountId + "/media";
    let nextParams = { fields, limit: pageSize };

    while (nextCall) {
      const page = await this._request(nextCall, nextParams);
      if (!page?.data) break;

      allItems.push(...page.data);

      if (limit && allItems.length >= limit) {
        allItems = allItems.slice(0, limit);
        break;
      }

      const next = page.paging?.next;
      if (!next) break;
      nextCall = next;
      nextParams = null;
    }

    // Merge insights per post.
    let doneCount = 0;
    for (const post of allItems) {
      const insights = await this.getMediaInsights(post.id, post.media_type);
      if (insights?.data) {
        for (const metric of insights.data) {
          if (metric.values?.length) {
            const key = METRIC_KEY_MAP[metric.name] || metric.name;
            post[key] = metric.values[0].value;
          }
        }
      }
      doneCount++;
      console.log(`  insights fetched for post ${doneCount}/${allItems.length} (${post.id})${this.lastError ? " -- last error: " + this.lastError : ""}`);
    }

    return { data: allItems };
  }

  async getBusinessDiscovery(username) {
    // Public data only for OTHER business/creator accounts -- likes,
    // comments, follower count, bio. No private insights (reach,
    // saved, shares, views breakdown) are available for accounts you
    // don't own; Meta doesn't expose that to anyone but the account
    // owner via their own token, and there's no way around that.
    const fields =
      `business_discovery.username(${username}){username,name,biography,followers_count,media_count,website,profile_picture_url,` +
      `media{id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count}}`;
    return this._request(this.accountId, { fields });
  }
}
