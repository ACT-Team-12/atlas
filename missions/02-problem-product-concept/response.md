# Team ATLAS · Mission 2: Problem & Product Concept

**Team:** ATLAS (Team 12) · Akhil Kumar Penugonda, Timothy Birt, Lilian Huynh, Anusmita Deb, Stephen Sookra  
**Live product:** https://atlas-team12.vercel.app · **Code:** https://github.com/ACT-Team-12/atlas (PR #1)

## 1. Problem statement

When **a patient leaves a clinic visit with new instructions (a new medicine, a lab, a referral, a follow-up)**, **the community health worker or patient navigator helping them** tries to **turn that paperwork into steps the patient can actually finish** but **the after-visit paper is written in clinical language, and the real blockers (transportation, cost, scheduling, language, tech access, not knowing how referrals work or what help exists) are not on it**, causing **labs, referrals and follow-ups that never happen, and a next visit that starts from zero**.

**We know:**

- "Many people face barriers that prevent or limit access to needed health care services, which may increase the risk of poor health outcomes and health disparities." Named barriers include lack of insurance, poor access to transportation and limited health care resources. (ODPHP, Healthy People 2030, Access to Health Services literature summary)
- About 36% of US adults (over 75 million) have Basic or Below Basic health literacy. Below Basic is about double the national rate among Medicaid recipients (30%) and the uninsured (28%). (NCES, National Assessment of Adult Literacy 2003, nces.ed.gov/pubs2006/2006483.pdf)
- In one large health system, only 34.8% of 103,737 referral scheduling attempts ended in a documented completed appointment. (Patel et al., J Gen Intern Med 2018;33:715-721)
- In two academic primary care practices, only 52.9% to 58.4% of ordered colonoscopies, stress tests and dermatology referrals were completed on time. (Amat et al., Jt Comm J Qual Patient Saf 2024;50(3):177-184)
- In 2017, 5.8 million people in the US (1.8%) delayed medical care because they did not have transportation. Medicaid recipients and people below the poverty line had higher odds. (Wolfe, McDonald, Holmes, Am J Public Health 2020)

**We still need to check:** whether community health workers and nonprofits in our chosen Atlanta area would use an app like this, which barriers come up most for their patients, and which local resources they already trust. These are Mission 3 interviews, not facts yet.

## 2. Current alternative and value proposition

| What people do today | What it misses |
|---|---|
| Paper after-visit summary plus memory | Clinical language, easy to lose, says nothing about getting a ride or paying for the lab |
| Pasting the summary into ChatGPT | Explains in the moment, but can invent instructions, keeps no plan, knows nothing about the patient's barriers or local help |
| Epic MyChart tools (Emmie) that simplify instructions | Only for patients whose health system offers it and who use the portal; explains, does not act on barriers |
| Searching online, community resource directories | Long generic lists; the person still has to figure out which one fits their barrier, hours and location |
| Calling the healthcare office | Helpful, but only during office hours, and the patient has to know what to ask |
| Social workers, patient navigators, CHWs (211, spreadsheets) | The best help today, but slow and manual; every worker rebuilds the same plan by hand |
| Friends and family | Depends on who you know and whether they've been through it |

**Value proposition:** ATLAS turns one visit into a plan a person can finish. It reads the patient's own paper, explains every step in their language, shows the exact line each step came from, and matches each blocker to a verified local resource. If something is not in the paper or not in the verified list, ATLAS says so instead of guessing. We will **reduce** missed follow-ups and **eliminate** the made-up advice risk of a general chatbot.

## 3. One-task product path

**Task:** turn an after-visit summary into a verified, doable follow-up plan.

1. **Entry:** a CHW, a nonprofit volunteer, or the patient opens ATLAS on a phone. No account needed.
2. **Action:** take a photo of the after-visit paper (or paste it), pick the language and reading level, and answer a short barrier check (ride, cost, schedule, language, internet, "how do referrals work?").
3. **Meaningful result:** a checklist of every medicine change, lab, referral, follow-up and warning sign, in plain words, each tied to the line it came from, plus a matched local resource for each barrier and a list of questions to bring to the next visit. The person checks things off, edits or removes anything.
4. **Failure / help state:** if a step is not clearly in the paper, ATLAS does not show it as an instruction. It moves it to "held back to protect you" or to "ask your clinic". Warning signs show a red banner with the clinic or 911 path. If no verified resource fits, it says so and offers a human (the CHW).

## 4. AI function, customer controls, non-AI baseline

- **AI function:** the AI receives the after-visit paper (photo or text), the chosen language and reading level, and the barrier answers. It extracts structured care steps (medicine, lab, referral, follow-up, daily care, warning sign), each with an exact quote, a plain-language explanation and the question to ask if the paper is unclear. Next, it matches each barrier to entries in our verified local resource list. A deterministic check we wrote ourselves rejects any step whose quote is not in the paper (and, next, any resource not in the verified list).
- **What the customer controls:** language and reading level; which barriers apply; checking off, editing or removing every step; whether the plan is kept (it is saved only in their own browser, and they can clear it). No account. Nothing is stored on our side; the paper is sent to our server and the AI provider only to be read.
- **Non-AI baseline:** the paper summary plus a fixed checklist template and a manual 211 search. In Mission 3 we will compare both on time to a complete plan and missed steps, using sample papers.

## 5. First executable code slice

- **Live:** https://atlas-team12.vercel.app (try "Use the sample summary", then "Make my plan")
- **Code:** https://github.com/ACT-Team-12/atlas, pull request #1. CI runs lint, typecheck, unit tests and a production build.
- **What works today:** paste or photo, AI extraction with 7 language options (English, Spanish, Vietnamese, Korean, Chinese, Amharic, French; Spanish and Vietnamese tested so far), the source-quote check, highlighted source view, questions for the doctor, "what your paper does not say", warning-sign banner, check off, remove (with undo), and the plan saved in the browser so people can come back to it.
- **What we measured (on our labeled sample paper, not a real patient):** 12 of 12 extracted steps passed the source-quote check in both Spanish and Vietnamese, 0 held back, about 22 to 27 seconds per run on the live site.
- **Also working now (added tonight):** the barrier check and a verified resource list for Fulton and DeKalb (41 HRSA community health centers with their nearest MARTA rail and bus stop, and 10 official programs such as Georgia Gateway, Medicaid, Grady financial assistance, MARTA Mobility and Reduced Fare, 211, the food bank and Lifeline). The plan can only cite resources from that list; anything else is dropped.
- **Next code task:** reminders by text or call, a CHW view of several patients, and real-user testing.
- **Owners:** build Akhil (owner) and Stephen (backup); Stephen owns testing and release.

## 6. FACTS check

- **Feed:** real evidence (the cited sources in section 1) and the real build state (live URL, PR #1). The sample summary is written by us and labeled as not a real patient.
- **Assess:** the AI pulled every step from the sample correctly and wrote plain Spanish and Vietnamese. Timing is slow (over 20 seconds) and needs work.
- **Challenge:** Akhil asked, "what does our app do that ChatGPT can't?" Our answer: it never shows a step it cannot point to in the patient's own paper, it plans around barriers with verified local help, and it is built for the CHWs and nonprofits who already help people. We also removed claims we could not source (for example a popular "patients forget 40 to 80%" figure, whose source we could not confirm).
- **Test:** a simpler path is the fixed checklist plus a 211 search. Mission 3 compares it to ATLAS with CHWs.
- **Steward:** every statistic has a citation, the sample is labeled, and real patient papers stay out of the app until we have consent and privacy rules written down.

## 7. Customer question for Mission 3

"When you help someone after a clinic visit, which step most often never happens (the lab, the referral, the pharmacy, the follow-up), and what stopped it?"
