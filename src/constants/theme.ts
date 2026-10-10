// Colors sampled from the Figma frames. Tweak here, nowhere else.
export const colors = {
  frame: '#CCE5F8',   // outer border of every screen
  box: '#D0E7F5',     // login box border + gaps
  white: '#FFFFFF',
  ink: '#111111',
  quote: '#7E94D6',   // periwinkle text on splash
  error: '#B3261E',
}

// TODO: put the exact Figma fonts here once the .ttf files are in assets/fonts
// and loaded with useFonts() in app/_layout.tsx. undefined = system font for now.
export const fonts: { body?: string; title?: string } = {
  body: undefined,
  title: undefined,
}

