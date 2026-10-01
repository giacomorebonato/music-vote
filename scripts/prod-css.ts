import { readFileSync } from 'node:fs'
import { $ } from 'bun'

const html = readFileSync('dist/index.html', 'utf8')
const match = html.match(
	/<link[^>]*rel=["']stylesheet["'][^>]*href=["'][^"']*\/([^"']+\.css)["'][^>]*>/,
)
if (!match) {
	throw new Error('No stylesheet link found in dist/index.html')
}
const cssFile = match[1]
await $`bunx @tailwindcss/cli -i frontend/app.css -o dist/${cssFile}`
console.log(`compiled ${cssFile} with Tailwind + daisyUI`)
