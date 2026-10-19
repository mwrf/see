# see

A short link server in the style of Google's internal **go/ links**. Type `go/wiki` in your browser and land on your wiki.

No dependencies: just Node.js 22.13+ with its built-in SQLite.

```sh
node see.js 8080        # or: npm start (port 80 by default)
npm test
```

Open http://localhost:8080 to browse, search and create links.

## How links work

| You type | You get |
| --- | --- |
| `go/gh` | the destination, e.g. `https://github.com` |
| `go/GH`, `go/g-h`, `go/g_h` | the same link: names ignore case, `-` and `_` |
| `go/gh/nodejs/node?tab=readme` | extra path and query are appended: `https://github.com/nodejs/node?tab=readme` |
| `go/bug/123` with destination `https://bugs.example.com/show?id=%s` | `%s` is replaced by the extra path: `…?id=123` |
| `go/gh+` | the link's detail page: stats, edit form, history |
| `go/something-new` | a "doesn't exist yet" page to create it, with "did you mean" suggestions |

Every change is recorded in the link's history, and visits are counted.

To make `go/` work in browsers, point the `go` host name at this server (DNS search domain, `/etc/hosts`, or a reverse proxy) and set `SEE_PREFIX=go/`. You can also add it as a browser search engine with `http://go/%s`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `80` | Port to listen on (the first command-line argument wins) |
| `SEE_DB` | `./see.db` | SQLite database file |
| `SEE_PREFIX` | host name + `/` | Label shown before names, e.g. `go/` |
| `SEE_USER_HEADER` | unset | Header your auth proxy sets with the signed-in user (e.g. `x-forwarded-email`). Turns on ownership: new links belong to their creator and only the owner can change them. Unset means anyone can edit. |
| `SEE_ADMINS` | unset | Comma-separated users who can change any link |

On first run, links from the old `mappings.json` file are imported into the database.

## API

| Request | Purpose |
| --- | --- |
| `GET /.api/links?q=&sort=name\|popular\|recent` | List or search links |
| `POST /.api/links` `{name, url, description}` | Create |
| `GET /.api/links/:name` | One link, with history |
| `PUT /.api/links/:name` `{name?, url?, description?, owner?}` | Update or rename |
| `DELETE /.api/links/:name` | Delete |
| `GET /.export` | Download all links as JSON |
| `GET /.healthz` | Health check |

Writes must be JSON (`Content-Type: application/json`); cross-site requests are rejected.

## Layout

- `see.js` — entry point and configuration
- `src/links.js` — name rules and URL expansion
- `src/db.js` — SQLite storage, migrations, history
- `src/server.js` — HTTP routes and API
- `src/views.js` — HTML pages
- `public/` — CSS, JavaScript, icon
- `test/` — tests (`npm test`)
