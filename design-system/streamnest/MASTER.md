# Streamnest Design System

## Direction

- Content-first desktop utility using an **Apple-inspired desktop system**: quiet hierarchy, macOS neutral surfaces, restrained translucency, and minimal elevation.
- Apple system blue is the only primary interaction color (`#007AFF` light / `#0A84FF` dark). YouTube red is reserved for source identification and never used as the app brand.
- Use the native Apple/system font stack with Chinese platform fallbacks; no remote font download, preventing startup delay and layout shift.

## Tokens

- Spacing follows a 4/8px rhythm. Main radii: 10px controls, 12–14px cards, 20–22px dialogs.
- Light surfaces use `#F5F5F7`, `#FFFFFF`, and `#1D1D1F`; dark surfaces use `#000000`, `#1C1C1E`, and `#F5F5F7`. Destructive and success colors always include text or icons.
- Body text is at least 4.5:1 contrast; visible focus uses a 3px translucent primary ring.
- Motion uses 120–250ms opacity/transform transitions and is disabled by `prefers-reduced-motion`.

## Material and elevation

- Translucency is limited to the persistent sidebar and floating batch bar, where it communicates layering.
- Content cards use a hairline border and subtle ambient shadow. Avoid gradients on progress, cards, and general decoration.
- Primary buttons are solid system blue; secondary controls use neutral filled surfaces without heavy outlines.

## Interaction

- All icon-only controls require an accessible label and at least a 38–44px hit area.
- Search runs only on explicit submit. Operations over 300ms show skeletons, progress, or a busy label.
- Preview behaves as a side panel on wide windows and a modal sheet below 1180px.
- The fixed batch bar never covers scroll content; result lists reserve bottom space while it is visible.
