Cloudflare worker-based app for personal work vacation tracking. Prettty. Mobile friendly.

You can enter your vacation per-year
supports categories and variable units (weeks or days) - each auto assigned a stable color

- Vacation (6 weeks, + 2 days carryover from last year)
- Flex (3 days)

Passkey auth

Start Date
End Date
Support partial days

- note vacation is either single day, partial single day, or multi-day. Don't have partial multi-day
  Public description
  Internal description

Has iCal feed so you can add it to your calendar

1. for you (full details)
2. for manager,team (only the public stuff)

Homepage dashboard
Year picker (defaults to current year)
Book Vacation button
Widgets showing used/remaining per category
Vacation details (list, newest at the top. color coded appropriately)
Can cancel/remove vacations

Want a peutifuyl PDF output. Cloudflare has a browser renderer thing that does this.

Bonus points if we could OAuth this with Office365 outlook and automatically add/remove from personal calendar.

Make sure to use latest wrangler, everything!

Deploy to afk.onewheelgeek.net (Away from Keyboard). this thing should exude sarcasm throughout.

Future: mailgun email notifications.
Identify boss. Emails notification or approval to boss.

Unit test/e2e test the SHIT out of this. It shoulkd work first try. Think very hard about passkeys since you mess that up a lot.
