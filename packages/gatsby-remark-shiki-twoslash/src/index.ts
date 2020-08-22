import { Highlighter } from "shiki/dist/highlighter"
import { commonLangIds, commonLangAliases, otherLangIds, TLang } from "shiki-languages"
import { twoslasher } from "@typescript/twoslash"
import { createDefaultMapFromNodeModules, addAllFilesFromFolder } from "@typescript/vfs"
import { createShikiHighlighter, ShikiTwoslashSettings } from "shiki-twoslash"

import visit from "unist-util-visit"
import { Node } from "unist"

import { renderToHTML } from "./renderer"

const languages = [...commonLangIds, ...commonLangAliases, ...otherLangIds]

type RichNode = Node & {
  lang: TLang
  type: string
  children: Node[]
  value: string
  meta?: string[]
  twoslash?: import("@typescript/twoslash").TwoSlashReturn
}

const defaultSettings = {}

/**
 * The function doing the work of transforming any codeblock samples
 * which have opted-in to the twoslash pattern.
 */
export const visitor = (highlighter: Highlighter, twoslashSettings?: ShikiTwoslashSettings) => (node: RichNode) => {
  let lang = node.lang
  let settings = twoslashSettings || defaultSettings

  const shouldDisableTwoslash = process && process.env && !!process.env.TWOSLASH_DISABLE

  // Run twoslash
  if (!shouldDisableTwoslash) runTwoSlashOnNode(settings)(node)

  // Shiki doesn't respect json5 as an input, so switch it
  // to json, which can handle comments in the syntax highlight
  const replacer = {
    json5: "json",
  }

  // @ts-ignore
  if (replacer[lang]) lang = replacer[lang]

  // Check we can highlight and render
  const shouldHighlight = lang && languages.includes(lang)

  if (shouldHighlight && !shouldDisableTwoslash) {
    const tokens = highlighter.codeToThemedTokens(node.value, lang)
    const results = renderToHTML(tokens, { langId: lang }, node.twoslash)
    node.type = "html"
    node.value = results
    node.children = []
  }
}

/**
 * The main interface for the remark shiki API, sets up the
 * highlighter then runs a visitor across all code tags in
 * the markdown running twoslash, then shiki.
 * */
const remarkShiki = async function (
  { markdownAST }: any,
  shikiSettings: import("shiki/dist/highlighter").HighlighterOptions,
  settings: ShikiTwoslashSettings
) {
  const highlighter = await createShikiHighlighter(shikiSettings)
  visit(markdownAST, "code", visitor(highlighter, settings))
}

/////////////////// Mainly for internal use, but tests could use this, not considered public API, so could change

/** @internal */
export const runTwoSlashOnNode = (settings: ShikiTwoslashSettings) => (node: RichNode) => {
  // Run twoslash and replace the main contents if
  // the ``` has 'twoslash' after it
  if (node.meta && node.meta.includes("twoslash")) {
    let map: Map<string, string> | undefined = undefined

    if (settings.useNodeModules) {
      const laterESVersion = 6 // we don't want a hard dep on TS, so that browsers can run this code)
      map = createDefaultMapFromNodeModules({ target: laterESVersion })
      // Add @types to the fsmap
      addAllFilesFromFolder(map, settings.nodeModulesTypesPath || "node_modules/@types")
    }

    const results = twoslasher(node.value, node.lang, { fsMap: map })
    node.value = results.code
    node.lang = results.extension as TLang
    node.twoslash = results
  }
}

/** Sends the twoslash visitor over the existing MD AST and replaces the code samples inline, does not do highlighting  */
export const runTwoSlashAcrossDocument = ({ markdownAST }: any, settings?: ShikiTwoslashSettings) =>
  visit(markdownAST, "code", runTwoSlashOnNode(settings || defaultSettings))

export default remarkShiki
