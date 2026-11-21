"""Small Battle.net Game Data API client (standard library only).

WoW Forever is undocumented. Observed in Nov 2026:
  namespace  dynamic-forever-{region} / static-forever-{region}
  houses     /data/wow/ruleset/{rulesetId}/auctions/{houseId}            (regular listings)
             /data/wow/ruleset/{rulesetId}/auctions/{houseId}/commodities
  The ruleset in the path does not select the market; the house id does.
  Snapshots change about once an hour; If-Modified-Since returns 304 when unchanged.
"""

import base64
import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "goldforge-collector/1.0 (+https://github.com/Hugodan/goldforge)"


def _maybe_gunzip(raw):
    return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw


class BnetError(Exception):
    pass


class Bnet:
    def __init__(self, client_id, client_secret, region="eu", opener=None):
        if not client_id or not client_secret:
            raise BnetError("Missing Battle.net client id/secret (BNET_CLIENT_ID / BNET_CLIENT_SECRET).")
        self.client_id = client_id
        self.client_secret = client_secret
        self.region = region
        self.host = f"https://{region}.api.blizzard.com"
        self._token = None
        self._token_expires = 0
        self._open = opener or urllib.request.urlopen
        self.requests = 0

    # -- auth -------------------------------------------------------------
    def token(self):
        if self._token and time.time() < self._token_expires - 300:
            return self._token
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        req = urllib.request.Request(
            "https://oauth.battle.net/token",
            data=b"grant_type=client_credentials",
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )
        with self._open(req, timeout=30) as r:
            body = json.loads(_maybe_gunzip(r.read()).decode())
        self._token = body["access_token"]
        self._token_expires = time.time() + int(body.get("expires_in", 3600))
        return self._token

    # -- requests -----------------------------------------------------------
    def get(self, path, namespace, params=None, if_modified_since=None, retries=3):
        """Returns (status, headers_dict, json_or_None). 304 -> (304, headers, None). 404 -> (404, headers, None)."""
        q = {"namespace": namespace}
        q.update(params or {})
        url = f"{self.host}{path}?{urllib.parse.urlencode(q)}"
        last_err = None
        for attempt in range(retries):
            headers = {
                "Authorization": f"Bearer {self.token()}",
                "Accept-Encoding": "gzip",
                "User-Agent": USER_AGENT,
            }
            if if_modified_since:
                headers["If-Modified-Since"] = if_modified_since
            req = urllib.request.Request(url, headers=headers)
            try:
                self.requests += 1
                with self._open(req, timeout=120) as r:
                    raw = r.read()
                    hdrs = {k.lower(): v for k, v in r.headers.items()}
                    raw = _maybe_gunzip(raw)
                    return r.status, hdrs, (json.loads(raw.decode("utf-8")) if raw else None)
            except urllib.error.HTTPError as e:
                hdrs = {k.lower(): v for k, v in (e.headers or {}).items()}
                if e.code == 304:
                    return 304, hdrs, None
                if e.code in (403, 404):
                    return e.code, hdrs, None
                if e.code == 401:
                    self._token = None
                last_err = e
                if e.code == 429 or e.code >= 500:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise BnetError(f"GET {path} failed: HTTP {e.code}") from e
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last_err = e
                time.sleep(2 * (attempt + 1))
        raise BnetError(f"GET {path} failed after {retries} attempts: {last_err}")

    # -- Forever helpers ------------------------------------------------------
    def dynamic_ns(self):
        return f"dynamic-forever-{self.region}"

    def static_ns(self):
        return f"static-forever-{self.region}"

    def house(self, ruleset_id, house_id, if_modified_since=None):
        return self.get(f"/data/wow/ruleset/{ruleset_id}/auctions/{house_id}", self.dynamic_ns(),
                        if_modified_since=if_modified_since)

    def commodities(self, ruleset_id, house_id, if_modified_since=None):
        return self.get(f"/data/wow/ruleset/{ruleset_id}/auctions/{house_id}/commodities", self.dynamic_ns(),
                        if_modified_since=if_modified_since)

    def house_index(self, ruleset_id):
        # The trailing slash matters: without it Forever answers 404.
        return self.get(f"/data/wow/ruleset/{ruleset_id}/auctions/", self.dynamic_ns())

    def item(self, item_id, locale="en_GB"):
        return self.get(f"/data/wow/item/{item_id}", self.static_ns(), params={"locale": locale})

    def item_media(self, item_id):
        return self.get(f"/data/wow/media/item/{item_id}", self.static_ns())
