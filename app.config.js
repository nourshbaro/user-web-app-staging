// BLUE staging uses HTTP. iOS 17+ supports an exact-IP ATS exception;
// iOS 10–16 does not enforce ATS for IP literals. Prefer HTTPS when available.
module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const paymentOrigin = process.env.EXPO_PUBLIC_BLUE_PAYMENT_ALLOWED_ORIGIN;
  const apiBaseUrl = process.env.EXPO_PUBLIC_LFA_API_BASE_URL;

  if (profile === "production" && paymentOrigin !== "https://payment.bluedfi.com") {
    throw new Error("Production BLUE payment must use the configured HTTPS provider origin.");
  }

  const stagingProfile = !profile || ["development", "preview", "apk"].includes(profile);
  const stagingBlue = stagingProfile
    && paymentOrigin === "http://161.97.169.240:3015"
    && apiBaseUrl === "https://api-lfa.matrixvert.com/api";
  if (!stagingBlue) return config;

  const infoPlist = config.ios?.infoPlist ?? {};
  const ats = infoPlist.NSAppTransportSecurity ?? {};
  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...infoPlist,
        NSAppTransportSecurity: {
          ...ats,
          NSExceptionDomains: {
            ...ats.NSExceptionDomains,
            // ATS exceptions target hosts, not ports or URL paths.
            "161.97.169.240": { NSExceptionAllowsInsecureHTTPLoads: true },
          },
        },
      },
    },
  };
};
