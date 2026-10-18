import React, { useState } from 'react'

interface Props {
  hasProject: boolean
  clip: React.ReactNode
  compression: React.ReactNode
  deliver: React.ReactNode
}

function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className={`inspector-section${open ? ' is-open' : ''}`}>
    <button className="inspector-heading" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span className="section-title">{title}</span>
      <span className={`section-chevron ${open ? 'open' : ''}`} />
    </button>
    {open && <div className="inspector-body">{children}</div>}
  </section>
}

// The selected clip's properties, then output settings. Crop and canvas live on the timeline toolbar.
export default function Inspector({ hasProject, clip, compression, deliver }: Props) {
  const empty = <div className="surface-note">Add a video to get started.</div>
  return <div className="inspector">
    {hasProject && <Section title="Clip properties">{clip}</Section>}
    <Section title="Compression">{hasProject ? compression : empty}</Section>
    <Section title="Export">{hasProject ? deliver : empty}</Section>
  </div>
}
