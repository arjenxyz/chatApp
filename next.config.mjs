import withPWA from "next-pwa";

// Next configuration values that are unrelated to the PWA plugin.
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true
};

// Options passed to the PWA plugin itself.
const pwaConfig = {
  dest: "public",
  disable: process.env.NODE_ENV !== "production",
  importScripts: ["/sw-push.js"],
  buildExcludes: [/app-build-manifest\.json$/]
};

// `withPWA` returns a function that takes the actual Next config so we call it
// in the correct order.  The previous version accidentally treated the
// entire configuration as plugin options, which resulted in Next receiving an
// array (and therefore numeric keys) and the subsequent webpack plugin
// getting invalid properties like `reactStrictMode`.
export default withPWA(pwaConfig)(nextConfig);
