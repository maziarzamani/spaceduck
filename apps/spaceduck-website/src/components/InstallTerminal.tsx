import { useState, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const commands = {
  unix: "curl -fsSL https://spaceduck.ai/install.sh | bash",
  windows: "irm https://spaceduck.ai/install.ps1 | iex",
} as const

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="ml-2 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-300"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  )
}

export function InstallTerminal() {
  const [activeTab, setActiveTab] = useState<"unix" | "windows">("unix")

  return (
    <Tabs defaultValue="unix" className="gap-0" onValueChange={(v) => setActiveTab(v as "unix" | "windows")}>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-surface-light">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-red-500/60" />
          <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
          <span className="h-3 w-3 rounded-full bg-green-500/60" />
          <span className="ml-3 text-xs text-slate-500">Terminal</span>

          <TabsList className="ml-auto h-auto rounded-md bg-transparent p-0 gap-1">
            <TabsTrigger
              value="unix"
              className="h-auto rounded-md border-0 bg-transparent px-2.5 py-1 text-xs text-slate-500 shadow-none hover:text-slate-300 hover:bg-white/5 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              macOS / Linux
            </TabsTrigger>
            <TabsTrigger
              value="windows"
              className="h-auto rounded-md border-0 bg-transparent px-2.5 py-1 text-xs text-slate-500 shadow-none hover:text-slate-300 hover:bg-white/5 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              Windows
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="unix" className="flex items-center justify-between px-5 py-5 font-mono text-sm">
          <p>
            <span className="text-primary-light">$</span>{" "}
            <span className="text-slate-200">{commands.unix}</span>
          </p>
          <CopyButton text={commands.unix} />
        </TabsContent>

        <TabsContent value="windows" className="flex items-center justify-between px-5 py-5 font-mono text-sm">
          <p>
            <span className="text-primary-light">&gt;</span>{" "}
            <span className="text-slate-200">{commands.windows}</span>
          </p>
          <CopyButton text={commands.windows} />
        </TabsContent>
      </div>
    </Tabs>
  )
}
