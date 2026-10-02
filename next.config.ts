import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
