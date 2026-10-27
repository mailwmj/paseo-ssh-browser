import assert from "node:assert/strict";
import { test } from "node:test";
import { forwardedUrl, parseRemoteUrl } from "../shared/remote-url";

test("preserves web protocols, paths, queries and fragments while changing only the endpoint", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    for (const protocol of ["http", "https"]) {
      const url = `${protocol}://${host}:3000/dashboard/a%2Fb?tab=home&x=%23#details`;
      assert.equal(forwardedUrl(url, 42001), `${protocol}://127.0.0.1:42001/dashboard/a%2Fb?tab=home&x=%23#details`);
      assert.equal(parseRemoteUrl(url).remoteHost, host === "[::1]" ? "::1" : "127.0.0.1");
      assert.equal(parseRemoteUrl(url).remotePort, 3000);
    }
  }
  assert.equal(parseRemoteUrl("https://localhost/").remotePort, 443);
  assert.equal(parseRemoteUrl("http://localhost/").remotePort, 80);
});

test("rejects invalid and non-loopback URLs before requesting a desktop", () => {
  for (const url of ["localhost:3000", "3000", "http://localhost:0", "http://localhost:65536", "http://example.com:3000/", "http://localhost.example.com/", "http://user:password@localhost/", "ftp://localhost/", "file:///tmp/test", "javascript:alert(1)"]) {
    assert.throws(() => parseRemoteUrl(url), Error, url);
  }
});
