pattern.mp4 is a synthetic 12 second H.264 test pattern generated with FFmpeg:

    ffmpeg -f lavfi -i testsrc2=size=128x72:rate=24:duration=12 -c:v libx264 -pix_fmt yuv420p -b:v 64k -an pattern.mp4

It contains no third party footage. The integration fixture inserts a large MP4
free box before the final moov box, so playback and seeking must work while the
file is incomplete, including metadata retrieval from its distant tail.
