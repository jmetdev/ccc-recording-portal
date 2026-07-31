# Setting up CCC Recording Portal with your Webex org

Two tracks — pick what applies. CUCM-only customers can skip the Service App.

## Track A — Webex org APIs (groups, admins, Webex Calling)

### 1. Authorize the Service App

In [Control Hub](https://admin.webex.com) → **Management → Apps → Service
Apps**, find **CCC Recording Portal**, review the requested permissions, and
click **Authorize**. You must be a **Full Administrator**.

After authorize:

- Your Webex org is linked for org-level APIs (admin detection, group sync).
- In the recording portal, **Settings → Webex setup** shows **Authorized**.
- **Settings → Group sync** can map Control Hub groups to portal roles.

This does **not** replace onboarding through CloudCoreCollab suite (pending
workspace → confirm org). Suite handles licensing; the Service App unlocks
Webex org APIs.

### 2. Log in with Webex

Go to the portal and choose **Continue with Webex**. Org admins are elevated
when Service App admin detection is available; everyone else lands with the
default role until group mappings apply.

### 3. WXC recording connector (Webex Calling)

If you record through **Webex Calling** (not on-prem UCM):

1. Authorize the Service App (step 1).
2. Open **Settings → WXC setup** and click **Enable WXC connector**.
3. The portal provisions a Docker poller with your org's Webex tokens and a
   connector credential — no manual CLI deploy.
4. **Settings → Recorded users** — add owner emails for seat licensing and
   group visibility.

Webex delivers muxed mono audio and a VTT transcript (no on-prem Whisper).
See `scripts/wxc-smoke-checklist.md` for verification steps.

## Track B — On-prem UCM only

Use **Settings → Connectors** and the one-line edge installer (kind **UCM**).
You do **not** need to authorize the Service App for UCM recording, playback,
or Whisper transcription.

## Optional

- **Group-based access**: Settings → Group sync (requires Track A authorize).
- **CUCM + Webex**: you can run both — Service App for directory/groups, CUCM
  connector for call recordings.
