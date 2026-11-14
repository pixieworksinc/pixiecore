"""HTTP acceptance for container bootstrap/recreation; no provider requests."""
import http.cookiejar
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

BASE = os.environ.get("DEMO_TEST_URL", "http://127.0.0.1:8088")
ROUTE = "/admin/config/pixiecore/specification"


class Form(HTMLParser):
    def __init__(self, text, form_id):
        super().__init__(convert_charrefs=True)
        self.target = form_id
        self.fields = {}
        self.active = False
        self.textarea = None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form":
            self.active = attrs.get("id") == self.target
        if not self.active:
            return
        if tag == "input" and attrs.get("name") and attrs.get("type") not in ["submit", "button"]:
            self.fields[attrs["name"]] = attrs.get("value", "")
        if tag == "textarea" and attrs.get("name"):
            self.textarea = attrs["name"]
            self.fields[self.textarea] = ""

    def handle_data(self, data):
        if self.active and self.textarea:
            self.fields[self.textarea] += data

    def handle_endtag(self, tag):
        if tag == "form":
            self.active = False
        if tag == "textarea":
            self.textarea = None


def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(opener, path, fields=None):
    body = urllib.parse.urlencode(fields).encode() if fields is not None else None
    try:
        with opener.open(BASE + path, body, timeout=30) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def form(opener):
    status, html = request(opener, ROUTE)
    assert status == 200 and "MOCK" in html
    result = Form(html, "pixiecore-specification-demo").fields
    assert "instruction" in result and "form_token" in result, "Missing editor form"
    return result


def submit(opener, action, fields=None):
    fields = fields or form(opener)
    fields[action] = {"save": "Save", "execute": "Execute", "reset": "Reset to initial Blueprint"}[action]
    status, _ = request(opener, ROUTE, fields)
    assert status == 200, "Editor submission failed"
    return form(opener)


def login():
    opener = client()
    status, html = request(opener, "/user/login")
    assert status == 200
    fields = Form(html, "user-login-form").fields
    fields.update(name=os.environ.get("DEMO_USER", "demo"),
                  **{"pass": Path(os.environ["DEMO_PASSWORD_FILE"]).read_text().strip(), "op": "Log in"})
    status, _ = request(opener, "/user/login", fields)
    assert status == 200
    return opener


def result(fields):
    # The disabled result textarea is rendered by the existing CodeMirror element.
    values = [value for value in fields.values() if '"schema_and_arithmetic"' in value]
    assert values, "No execution record in the rendered form"
    return json.loads(values[0])


def verify_replay():
    anon = client()
    assert request(anon, "/")[0] == 200
    assert "PixieAgent" in request(anon, "/")[1]
    with anon.open(BASE + "/pixieagent/", timeout=10) as response:
        assert "connect-src 'none'" in response.headers["Content-Security-Policy"]
        assert response.headers["X-Content-Type-Options"] == "nosniff"
    for path in ["/pixieagent/", "/pixieagent/app.js", "/pixieagent/style.css", "/pixieagent/data.js"]:
        assert request(anon, path)[0] == 200
    for path in ["/pixieagent/live/", "/sites/default/settings.php", "/sites/default/files/test.php", "/vendor/autoload.php", "/.env"]:
        assert request(anon, path)[0] == 404
    # Drupal may deny or redirect an anonymous editor request, but never expose the form.
    status, html = request(anon, ROUTE)
    assert status in [200, 403] and "data-specification-editor" not in html


verify_replay()
user = login()
assert request(user, "/admin/people")[0] == 403
initial = form(user)
if "--restored" in sys.argv:
    record = result(initial)
    assert int(initial["revision"]) == 3 and record["data"]["final_price"] == 960
    print("Container recreation retained revision 3 and its execution result.")
    sys.exit(0)
assert int(initial["revision"]) == 0
bad = dict(initial, form_token="invalid-csrf-token")
submit(user, "save", bad)
assert int(form(user)["revision"]) == 0, "Invalid CSRF token changed state"
saved = submit(user, "save")
assert int(saved["revision"]) == 1
executed = submit(user, "execute")
assert result(executed)["data"] == {"discount": 0.2, "final_price": 960}
changed = dict(executed)
changed["instruction"] = changed["instruction"].replace("strictly greater than 1000", "strictly greater than 2000")
submit(user, "execute", changed)
assert int(form(user)["revision"]) == 1
saved = submit(user, "save", changed)
assert int(saved["revision"]) == 2
assert result(submit(user, "execute"))["data"] == {"discount": 0, "final_price": 1200}
assert int(submit(user, "reset")["revision"]) == 3
assert result(submit(user, "execute"))["data"]["final_price"] == 960
print("Bootstrap, restricted login, CSRF, Save/Execute/Reset and both fixtures passed.")
