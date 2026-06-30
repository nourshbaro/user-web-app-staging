# LFA User App New

Expo app version of `user-new`, using the same LFA backend APIs with a simple mobile UI.

## Get Started

1. Configure the API environment:

```bash
cp .env.example .env
```

2. Install dependencies and start Expo:

```bash
npm install
npm run web
```

## Features

- Scheduled matches with team and stadium filters.
- Match detail with zones, quantities, and available seat selection.
- Cart reservation session with countdown timer.
- Login, registration, OTP verification, and logout.
- Checkout submission using the same checkout API payload shape as `user-new`.
- Profile screen for orders and tickets.
