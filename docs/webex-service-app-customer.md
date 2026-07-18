# Setting up CCC Recording Portal with your Webex org

Two quick steps for your Webex Control Hub administrator — everything else is
automated.

## 1. Authorize the Service App

In [Control Hub](https://admin.webex.com) → **Management → Apps → Service
Apps**, find **CCC Recording Portal**, review the requested permissions, and
click **Authorize**. You must be a **Full Administrator**.

The moment you authorize, your organization is automatically set up in the
portal — no ticket, no waiting. If you're recognized as a Webex org admin,
you'll land as an administrator the first time you log in; everyone else in
your org lands as a regular user.

## 2. Log in with Webex

Go to the portal and choose **Continue with Webex**. That's it — one login
gets you into the recording portal (and, if your organization also uses
CloudCoreFax, that product too).

## Optional, as you need them

- **Group-based access control**: if you want specific Webex Control Hub
  groups to map to specific view permissions in the recording portal, an
  admin can set that mapping under Settings once you're logged in.
- **A cloud-hosted Webex recording connector**: if your organization records
  calls through Webex Calling (rather than an on-prem CUCM), your dedicated
  connector instance is provisioned automatically as part of onboarding — no
  separate installation needed.

If you *do* record through an on-prem CUCM deployment instead, that still
uses the existing one-line installer under Settings → Connectors — nothing
about that changes.
