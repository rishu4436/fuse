# BCH BLAZE 2026 submission checklist

The organizer lists **22 November at 14:00 UTC / 19:30 IST** as the end of hacking. Registration closed on 13 November. The 21 November check-in is scheduled for 19:30 IST. Attendance at that event alone does not establish earlier preparation-stream attendance. [Official schedule](https://bchblaze.com/)

| Item | Evidence or next action |
|---|---|
| Public source | [Repository](https://github.com/rishu4436/fuse) and [development PR](https://github.com/rishu4436/fuse/pull/1). Check the release SHA in the handoff. |
| Live application | [Open FUSE](https://fusebch.vercel.app). Live execution, historical evidence and sandbox are separately labeled. |
| Mainnet capability | [Index of 16 transactions](SUBMISSION-EVIDENCE.md). Seven receipts include contract-outcome checks. |
| Wallet | Cashonize v0.16.0 on WizardConnect, one mainnet flash. [Approval evidence](../evidence/mainnet/wizardconnect-cashonize/) |
| Presentation | [Judging slides](https://fusebch.vercel.app/judging/FUSE.pdf) and [editable deck](../apps/web/public/judging/FUSE.pptx). Covers the template's story, benefits, BCH usage and vision. If the form requires its hosted editor, copy the content into the [official template](https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit), grant public viewing, and use the resulting URL. |
| Video and images | [Narrated 3:54 draft](https://fusebch.vercel.app/judging/FUSE-demo.mp4), [screen captures](../evidence/screenshots/) and [shot sources](DEMO-SHOTLIST.md). Verify file formats and count in the authenticated form. |
| EMBER2026 | Owner must supply a token-aware mainnet receiving address they control. Set `NEXT_PUBLIC_DONATION_ADDRESS` in [FUSE production settings](https://vercel.com/rishu4436s-projects/fuse/settings/environment-variables), rebuild and inspect the top banner. |
| Registration and roll call | Owner must confirm their registered DoraHacks team and qualifying preparation-stream attendance. Use [DoraHacks](https://dorahacks.io/hackathon/bchblaze2026) and [the broadcast room](https://bchblaze.com/live/). Ask the organizers about missing records. |
| Telegram confirmation | Owner confirms the project and membership in [BCH BLAZE Telegram](https://t.me/bchblaze). |
| Prior work / attribution | Confirm dates and which components the team built during the event. Disclose pre-existing code and third-party components, including CashScript, libauth, WizardConnect, Cauldron and Paryon. Git history alone cannot establish personal eligibility. |
| Submission form | The direct DoraHacks request returned human verification. Owner signs in, confirms current rules and field requirements, selects Mainnet Track, attaches artifacts, completes disclosures and saves the submitted BUIDL URL. |
| Sponsor claims | Current evidence supports native BCH execution and WizardConnect. The XO bounty calls for an inspectable executed invitation and personally written feedback. The stablecoin bridge bounty requires a cross-chain transfer. Neither award is claimed here. [Official sponsor rules](https://bchblaze.com/bounties/) |

## Project description for the form

FUSE composes a Bitcoin Cash transaction that can borrow from a FlashVault, trade through two Cauldron pools and repay the vault atomically. Guardian and the BCH VM check the exact transaction before the wallet signs. Judges can inspect the recorded wallet approval, reproduce settlement verification, and try simulated solver competition without funds. The recorded two-pool trade cost 1,991 sats. Paryon monitoring is read-only. The recorded mainnet solver competition ran under a single operator.

The organizer's site and template were available. The field-specific Mainnet Track and roll-call details were cross-checked against the [event listing](https://www.competehub.dev/en/competitions/dorahacksbchblaze2026). The authenticated DoraHacks form governs eligibility.
