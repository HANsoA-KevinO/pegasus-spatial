import Image from 'next/image'
import type { HTMLAttributes } from 'react'

export function BrandMark({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 overflow-hidden rounded-[28%] bg-[#101216] ring-1 ring-black/10 dark:bg-[#07080b] dark:ring-white/10 ${className}`}
      {...props}
    >
      <Image
        src="/brand/spatial-logo-marble.png"
        alt=""
        fill
        sizes="40px"
        className="object-contain p-[8%]"
        priority
      />
    </span>
  )
}
