/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
    return [
      {
        source: "/api/dashboard/:path*",
        destination: `${backend}/api/dashboard/:path*`,
      },
      {
        source: "/api/webhook",
        destination: `${backend}/api/webhook`,
      },
      {
        source: "/api/store/:path*",
        destination: `${backend}/api/store/:path*`,
      },
      {
        source: "/api/health",
        destination: `${backend}/api/health`,
      },
    ];
  },
};

export default nextConfig;

