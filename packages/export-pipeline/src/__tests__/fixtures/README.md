# Image codec fixtures

Both images contain synthetic pixels generated locally with Python Pillow; neither contains course artwork.

- `opaque-wide.png`: 2100 × 10 RGB pixels, three `random.Random(7).randrange(256)` values per pixel, saved with PNG optimization. Exercises resizing above the 1920-pixel limit.
- `oriented-jpeg.jpg`: 120 × 80 RGB gradient, pixel `(x, y)` = `((x * 2) % 256, (y * 3) % 256, 64)`, JPEG quality 90, EXIF Orientation 6. Exercises rotation before metadata-free WebP encoding.
