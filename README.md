# My support plan — imhomeless.ca

A free, independent Canadian resource directory with English and French pages,
province/territory filters, practical guides and browser-local personal tools.
It is not a service provider and does not show live shelter availability.

The main and test repositories receive the same functional changes. The main
copy preserves `CNAME`; the test copy preserves its directory-before-urgent-help
layout and uses its own GitHub Pages subpath. No external fonts, analytics,
accounts, server database or paid dependencies are used.

## Edit and build

Edit `resources.json`, `build.mjs`, `personal.html`, `personal.js`, `app.js`, and
`styles.css`. Run `npm run build` for the main copy or `npm run build:test-copy`
for the test copy. Commit both generated documents, `index.html` and `fr.html`.
GitHub Pages serves these directly; no hosted build step is required.

Run `npm test` using Node.js 22 or newer. On restricted Windows environments,
prepend `--preserve-symlinks --preserve-symlinks-main` to the Node command if
the sandbox prevents resolving parent-directory paths.

## Resource accuracy

Every listing has its own official source and `checked` date. Dates record
web-page review, not phone testing, opening-hours validation or available beds.
Provider hours, eligibility, costs and access vary. See `sources.md` for source
notes and regional caveats. Report public corrections through this repository's
Issues tab; do not include private personal information.

## Personal data and shared devices

New visits default to memory-only use. Visitors can explicitly save on this
device or encrypt journal, goals and reminders with a passphrase/PIN of at least
eight characters (PBKDF2-SHA256 and AES-GCM through WebCrypto). Encryption does
not protect an unlocked screen or a monitored device. Hidden encrypted tabs
lock; there is no password recovery. Legacy records are migrated only after a
verified write. Conflicting changes in another tab invalidate the stale page.
Main/test data and offline caches are scoped to their own application paths.

JSON export/restore, print, journal editing, delete undo and calendar `.ics`
downloads are available. Exports and printouts contain readable private data.
Calendar apps handle reminder alerts; the site does not send notifications.
Clearing this app does not erase browser history, downloads or other copies.

## Offline and installation

`sw.js` caches the complete public English/French shell and only reports ready
after every required asset is present. The first visit requires a connection;
external service websites/chat still need internet, and calls/SMS need phone
service. Browser data can be evicted. Installation is not a backup.

When app assets change, increment `OFFLINE_VERSION` in `sw.js` and the matching
version in `offline.js`. Updates wait for old tabs to close to protect open
forms. Both manifests use relative scopes; French installation opens `fr.html`.

Quick exit opens a neutral website and conceals this document when JavaScript
is available. It does not erase history or defeat monitoring. The host receives
normal connection information, and linked services have their own policies.
