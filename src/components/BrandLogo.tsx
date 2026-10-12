import Image from 'next/image';

interface BrandLogoProps {
  size?: number;
  className?: string;
  priority?: boolean;
}

export default function BrandLogo({
  size = 40,
  className = '',
  priority = false,
}: BrandLogoProps) {
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden rounded-xl shadow-md shadow-emerald-600/20 ring-1 ring-emerald-500/20 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src="/apple-touch-icon.png"
        alt="Namozlarim Logo"
        width={size}
        height={size}
        priority={priority}
        className="w-full h-full object-cover rounded-xl"
      />
    </div>
  );
}
