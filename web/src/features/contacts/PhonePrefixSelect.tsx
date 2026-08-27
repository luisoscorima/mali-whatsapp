import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import {
  DEFAULT_PHONE_PREFIX,
  digitsOnly,
  flagSrc,
  findPhonePrefixOption,
  PHONE_PREFIX_OPTIONS,
  type PhonePrefixOption,
} from './phonePrefixOptions'

type PhonePrefixSelectProps = {
  value: string
  disabled?: boolean
  onChange: (prefix: string) => void
}

export function PhonePrefixSelect({
  value,
  disabled = false,
  onChange,
}: PhonePrefixSelectProps) {
  const [open, setOpen] = useState(false)
  const prefixDigits = digitsOnly(value) || DEFAULT_PHONE_PREFIX
  const known = findPhonePrefixOption(prefixDigits)

  function pick(option: PhonePrefixOption) {
    onChange(option.value)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="mt-1 flex w-full items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-left text-sm disabled:opacity-60"
          aria-label={known ? `Prefijo ${known.label}` : `Prefijo +${prefixDigits}`}
        >
          {known ? (
            <img
              src={flagSrc(known.iso)}
              alt=""
              width={22}
              height={16}
              className="h-4 w-[22px] shrink-0 rounded-sm object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
            />
          ) : null}
          <span className="font-medium">+{prefixDigits}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(100vw-2rem,16rem)] p-1">
        <ul className="max-h-60 overflow-y-auto" role="listbox">
          {PHONE_PREFIX_OPTIONS.map((option) => {
            const active = option.value === prefixDigits
            return (
              <li key={option.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={
                    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-strong ' +
                    (active ? 'bg-surface-strong font-medium' : '')
                  }
                  onClick={() => pick(option)}
                >
                  <img
                    src={flagSrc(option.iso)}
                    alt=""
                    width={22}
                    height={16}
                    className="h-4 w-[22px] shrink-0 rounded-sm object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
                  />
                  <span className="min-w-0 truncate">
                    {option.label}{' '}
                    <span className="text-muted">(+{option.value})</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
