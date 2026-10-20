# Voxa iOS client scaffold

An Expo / React Native / TypeScript app shell, not a native voice client yet.
It offers a configurable backend origin, a user-triggered read-only
`GET /api/health` check, useful connection/authentication errors, and visible
provider-configuration status. It never creates a voice session or contacts a
model provider. No microphone permission or background-audio entitlement is
requested.

## Run on a Mac

Use Node.js 22.13+ and npm. For the simulator or native iOS build, install a
compatible Xcode and iOS Simulator on the same Mac as the backend. This package
pins Expo 58.0.16, React Native 0.88.0, and React 19.3.0 from Expo's published
blank-TypeScript template and bundled dependency map; `package-lock.json` locks
transitive dependencies too.

From the repository root:

```sh
npm --prefix ios-client ci
# Optional. This contains a public URL only, never credentials.
cp ios-client/.env.example ios-client/.env
make backend
```

In another terminal:

```sh
npm --prefix ios-client run ios
```

Use a compatible Expo Go simulator runtime. If Expo Go compatibility is not
available, `npm --prefix ios-client run ios:native` generates and builds the
native iOS project locally with Xcode. Generated `ios/` and `android/` folders
are ignored. `com.example.voxa` is a development placeholder, not a registered
production bundle identifier.

Both Metro (`--localhost`) and the existing API stay local by default. The
default API origin is `http://127.0.0.1:4318`; `http://localhost:4318` is also
accepted. No other plaintext origin or port is accepted. The iOS config allows
local networking for simulator development, but does not set
`NSAllowsArbitraryLoads` or turn off TLS validation.

**A physical iPhone cannot reach the Mac's loopback-only API.** Do not change the
backend bind address or weaken its host/origin checks to make a QR code work.
A device needs an explicitly deployed, authenticated HTTPS backend and a
separately installed native build. Installing Expo Go, an Xcode build, a
development build, or TestFlight distribution is a separate setup step. This
scaffold does not deploy a backend, configure Apple signing, upload a build,
or create an EAS project.

## Configure an authenticated backend

Set the public default in `EXPO_PUBLIC_API_BASE_URL`, or edit the URL in the
app. Supply an origin such as `https://voice.example.com`, not `/api`, a login
URL, embedded credentials, or a query string. Use only a backend you control
and trust. Every credentialed request goes to the configured backend.

Production protects `/api/health` with the backend's single-user HTTP Basic
authentication. Enter that backend's username and password in the app.
The provider's permanent OpenAI API key is different and belongs only in the
server's environment. The local backend needs no Basic credentials.

- Credentials are accepted only for HTTPS and printable ASCII; usernames may
  not contain a colon. The server also validates its configured credentials.
- They are held only in component/request memory, not written to storage,
  Expo config, an environment variable, analytics, or logs. They clear when
  the URL changes, when the app becomes inactive/backgrounded, or when **Clear
  credentials** is pressed. JavaScript garbage collection is not a secure
  memory-erasure guarantee.
- Requests omit cookies and `Origin`, request no caching, and request
  `redirect: 'error'`. A redirected or unexpected final response URL is also
  rejected. Configure the proxy to serve `/api/health` directly, without
  authentication redirects. Native redirect/cookie behavior must still be
  verified on the actual iOS transport before production use; offline Fetch
  tests do not establish native networking behavior.
- A check has an eight-second deadline and is cancelled when leaving the app,
  editing settings, replacing the request, or unmounting. No automatic polling
  is enabled. Status resets when inputs change.
- A successful check validates the health schema. `realtimeConfigured` means
  server configuration exists, not that provider credentials are valid,
  account/model access works, audio is usable, or storage is healthy.
- The public `/healthz` endpoint is liveness only. This app deliberately does
  not substitute it for an authenticated `/api/health` check.

Everything prefixed `EXPO_PUBLIC_` is readable in the compiled application.
Never put passwords, provider keys, bearer tokens, or shared server secrets
in Expo public configuration, `app.json`, source code, or checked-in files.
Backend Basic authentication is only an initial single-user boundary, not a
multi-user identity system. Do not distribute your personal backend credentials
with the app.

## Verify without model usage

```sh
npm --prefix ios-client run check
npm --prefix ios-client run export:ios
```

`check` runs TypeScript and Node's offline fixture tests for URL validation,
HTTPS-only credentials, request shape, response validation, auth/network/JSON
errors, redirect-result rejection, timeout, and cancellation. Tests use only
synthetic values and injected Fetch responses. The iOS export is a JavaScript
bundle check, not an Xcode build or simulator test.

Manual acceptance still required:

1. Launch on the iOS Simulator with the backend on the same Mac. Check health
   without a provider key, then with server-side configuration if desired.
   A health check itself must make no provider calls.
2. Check the offline API, invalid URL, wrong credentials, malformed/HTML
   response, timeout, and cancellation behavior. Confirm no late stale result
   replaces a changed URL or cleared credentials.
3. Check on a physical iPhone against an authorized HTTPS deployment. Inspect
   TLS, redirect refusal, cookie isolation, Basic challenge behavior, and
   credential clearing after app switching. Never use real credentials
   against an untrusted test server.
4. Inspect the screen at large text sizes and with VoiceOver. Confirm keyboard
   visibility, safe areas, and readable status feedback on phone and tablet.

No simulator/device run, Xcode build, Apple signing, live production
authentication check, live provider call, or listening test is established by
the offline checks.

## Next milestones

1. Choose and validate the native WebRTC transport in an Expo development
   build. Keep provider/session wire logic separate from the UI; reuse the
   backend's owned-call setup contract rather than bundling permanent keys.
2. Implement microphone permission, start/end/mute, bounded setup, interruption,
   reliable cleanup, and explicit failure states. Port archive and selected
   summary flows with the same privacy boundaries as the web client.
3. Test audio routing, actual earbuds/Bluetooth, interruptions, lock/unlock,
   foreground/background transitions, and network loss on real devices.
   Background audio is not a capability of this scaffold.
4. Before distribution, select a real bundle identifier and auth/session
   design, review secure credential handling and native network behavior,
   and set up signing/build delivery under explicit authorization.

The repository's existing web client remains the working voice experience.
Product intent and historical verification remain in `../docs/DESIGN.md` and
`../docs/PLANS.md`.

## References

- [Expo SDK compatibility](https://docs.expo.dev/versions/latest/)
- [Expo's official blank TypeScript template](https://www.npmjs.com/package/expo-template-blank-typescript)
- [Expo public environment-variable security](https://docs.expo.dev/guides/environment-variables/)
- [Apple local-networking ATS setting](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
