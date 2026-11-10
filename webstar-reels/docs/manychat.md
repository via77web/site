# Comment-to-DM with ManyChat (Instagram)

Every caption ends its copy with a keyword prompt. When someone comments that word on a reel, ManyChat sends them a DM with the brand's tracked link.

| Brand | Keyword | Caption line |
| --- | --- | --- |
| WEBSTAR | `WEBSITE` | Comment WEBSITE and we'll send you the link. |
| VIA77 | `STORE` | Comment STORE and we'll send you the details. |
| VERRANO | `QUOTE` | Comment QUOTE and we'll send you the link. |

The keyword and the line live in each `brands/<id>.json` as `commentKeyword` and `commentPrompt`. Change them there and every new caption follows; remember to change the ManyChat trigger to match.

ManyChat only automates Instagram here. On TikTok and YouTube the same caption carries the reel's tracked link in place of the comment line, because nothing would answer the comment.

## Before you start

- Each brand needs an Instagram **Business** account (not Creator: ManyChat's comment automation needs Business), connected to a Facebook Page.
- One ManyChat account can hold several Instagram accounts, each as its own workspace. Comment automation needs ManyChat Pro once you pass the free contact limit.
- Run `npm run tracking:setup`. It prints each brand's **ManyChat DM** link. Use that link in the DM, not the plain site address, so DM clicks are counted.

## Set up one brand (repeat for each)

1. **Connect Instagram.** ManyChat → Settings → Channels → Instagram → Connect, and pick the brand's account. Approve every permission it asks for.
2. **Create the automation.** Automation → New Automation → Start From Scratch. Name it after the keyword, e.g. `Comment WEBSITE`.
3. **Trigger.** Add Trigger → Instagram → **User comments on your Post or Reel**.
   - Post or Reel: **Any post or reel** (so every new reel is covered without touching ManyChat again).
   - Comment contains: the keyword, e.g. `WEBSITE`. Add common slips too: `website`, `web site`. Matching is not case-sensitive.
4. **Public reply (optional but worth it).** Turn on **Reply to comment** and add two or three variations, e.g. "Sent! Check your DMs." Variations stop Instagram treating the replies as spam.
5. **The DM.** Add an Instagram message:
   - Text, in the brand's voice. Examples below.
   - A **button** with the URL set to the brand's ManyChat DM link from `npm run tracking:setup`. A button gets more taps than a bare link.
6. **Follow-up for non-followers (optional).** Instagram only lets a business send the first automated DM as a reply to the comment; ManyChat handles this, but the person must tap the button or reply before you can send anything else. Keep everything they need in that first message.
7. **Publish**, then test from a different Instagram account: comment the keyword on any reel and check that the DM arrives and the button opens the site with `utm_medium=dm` in the address.

## Messages to start from

**WEBSTAR** (fun, transparent, punchy)

> Here you go. Every tier, what's in it and what it costs. No calls needed to see a price.
> Button: **See the tiers**

**VIA77** (premium, calm, considered)

> Thank you for asking. Here is how we approach a commerce build, and how to start a project with us.
> Button: **View the work**

**VERRANO** (practical, satisfying, trade-proud)

> Thanks for asking. Send us a photo of the space and rough sizes and we'll come back with a quote. Details here:
> Button: **Get a quote**

## What gets tracked

- The button link is the brand's `…-dm` tracked link, so each tap is logged as a click with `utm_medium=dm` and `utm_campaign=comment-<keyword>`.
- A comment-to-DM link can't know which reel the comment was on. In the weekly insights those clicks, and any enquiry or deposit that follows, are credited to the brand's most recent reel at that moment, and the report says so.
- If you later want exact per-reel DM attribution, make one ManyChat automation per reel (trigger: that specific reel) and use that reel's own tracked link in the button. It's accurate but manual, so it's worth doing only for reels you boost.

## Staying inside Instagram's rules

- Only message people who commented; never import lists or DM cold.
- Keep the public reply honest ("Sent you a DM"), and vary it.
- Don't ask for comments in a way that reads as engagement bait ("comment to win"); a keyword in exchange for a link is fine.
