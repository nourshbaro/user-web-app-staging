export const OFFICIAL_CONTACTS = [
  // {
  //   label: "Instagram",
  //   url: "https://www.instagram.com/thelfadotcom/",
  //   brand: "instagram",
  // },
  // {
  //   label: "Facebook",
  //   url: "https://www.facebook.com/thelfadotcom",
  //   brand: "facebook",
  // },
  // { label: "X", url: "https://x.com/thelfadotcom", brand: "x" },
  {
    label: "WhatsApp",
    accessibilityLabel: "Contact us on WhatsApp",
    appUrl: "whatsapp://send?phone=96170447888",
    url: "https://wa.me/96170447888",
    brand: "whatsapp",
  },
  {
    label: "Email",
    url: `mailto:${encodeURIComponent("info@lfa-ticketing.com")}`,
    icon: { ios: "envelope", android: "mail", web: "mail" },
  },
] as const;
