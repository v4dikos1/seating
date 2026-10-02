import { useState } from 'react';
import { Button } from './ui';

export function CopyId({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return <span className='journey-id'><span>{label}: <code>{value}</code></span><Button kind='quiet' onClick={() => {
    void navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false));
  }}>{copied ? 'Скопировано' : 'Скопировать'}</Button></span>;
}
