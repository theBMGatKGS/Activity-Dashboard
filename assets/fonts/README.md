# Self-hosted fonts (00.05.000)

The Daily Focus screen uses two open-source font families. They are served from this folder, so the page's security policy (`default-src 'self'`) needs no change and the fonts work offline.

| File | Family / weights | Source file | Licence |
|---|---|---|---|
| `SpaceGrotesk-var-latin.woff2` | Space Grotesk, variable 300–700 (v2.000) | upstream OFL font archive `ofl/spacegrotesk/SpaceGrotesk[wght].ttf` | SIL OFL 1.1, `OFL-SpaceGrotesk.txt` |
| `IBMPlexMono-400-latin.woff2` | IBM Plex Mono Regular (v2.3) | upstream OFL font archive `ofl/ibmplexmono/IBMPlexMono-Regular.ttf` | SIL OFL 1.1, `OFL-IBMPlexMono.txt` |
| `IBMPlexMono-500-latin.woff2` | IBM Plex Mono Medium (v2.3) | upstream OFL font archive `ofl/ibmplexmono/IBMPlexMono-Medium.ttf` | SIL OFL 1.1, `OFL-IBMPlexMono.txt` |

Downloaded Oct 23 2026 from the upstream OFL font archive on GitHub (paths above; verify with the SHA-256 values below).

## SHA-256

Source files:
- `SpaceGrotesk[wght].ttf` acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72
- `IBMPlexMono-Regular.ttf` 6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46
- `IBMPlexMono-Medium.ttf` a9b4c49bb299e05b5f6c481e7fb5e78943d2793249a0c8874ab574a2d1ea6755

Shipped subsets:
- `SpaceGrotesk-var-latin.woff2` 792322af30430c78cc06157c6d018f1a746690315fb423daa85fd5ceba795912
- `IBMPlexMono-400-latin.woff2` f9fa09bd3da7e165e41589144b36ac36abdb632ce8f9a40ae6c777d7a5f63730
- `IBMPlexMono-500-latin.woff2` b81fc435db39cf7d150f0ea60fe1ec93a1ef55109b8b9de61d6e9dfd6012f945

## Subset command (fontTools 4.65, brotli)

```
U="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+25A0-25FF,U+2600-26FF,U+2713,U+2715"
pyftsubset "SpaceGrotesk[wght].ttf" --unicodes="$U" --flavor=woff2 --layout-features='*' --output-file=SpaceGrotesk-var-latin.woff2
pyftsubset IBMPlexMono-Regular.ttf --unicodes="$U" --flavor=woff2 --output-file=IBMPlexMono-400-latin.woff2
pyftsubset IBMPlexMono-Medium.ttf  --unicodes="$U" --flavor=woff2 --output-file=IBMPlexMono-500-latin.woff2
```

The total is about 54 KB. Symbols the fonts do not contain (for example ★ ◆ ◐ ✈) fall back to the system font; the status icons in rows are inline SVG.
