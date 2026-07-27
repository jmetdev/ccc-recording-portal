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

### 3. Optional: hosted Webex Calling connector

If you record through **Webex Calling** (not on-prem CUCM), open
**Settings → Webex setup** and enable the hosted connector after authorize.
Recording retrieval may require additional Webex compliance approvals — your
CloudCoreCollab contact will confirm when that path is fully live.

## Track B — On-prem CUCM only

Use **Settings → Connectors** and the one-line edge installer. You do **not**
need to authorize the Service App for CUCM recording, playback, or Whisper
transcription.

## Optional

- **Group-based access**: Settings → Group sync (requires Track A authorize).
- **CUCM + Webex**: you can run both — Service App for directory/groups, CUCM
  connector for call recordings.
