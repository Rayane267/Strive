import Image from 'next/image';

export default function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Image
        src="/strive-logo.png"
        alt="Strive"
        width={32}
        height={32}
        priority
        className="h-8 w-8 rounded-[9px] shadow-[0_4px_18px_rgba(0,230,118,0.25)]"
      />
      <span className="font-display text-lg font-bold tracking-tight">Strive</span>
    </div>
  );
}
