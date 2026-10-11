import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'accelerometer=(self), gyroscope=(self), magnetometer=(self), geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/history',
        destination: '/progress?tab=history',
        permanent: false,
      },
      {
        source: '/stats',
        destination: '/progress?tab=overview',
        permanent: false,
      },
      {
        source: '/analytics',
        destination: '/progress?tab=analytics',
        permanent: false,
      },
      {
        source: '/calendar',
        destination: '/progress?tab=history',
        permanent: false,
      },
      {
        source: '/qaza',
        destination: '/progress?tab=qaza',
        permanent: false,
      },
      {
        source: '/calculator',
        destination: '/progress?tab=qaza',
        permanent: false,
      },
      {
        source: '/profile',
        destination: '/account?tab=profile',
        permanent: false,
      },
      {
        source: '/settings',
        destination: '/account?tab=preferences',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
