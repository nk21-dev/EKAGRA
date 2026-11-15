const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Target output directory
const outDir = path.resolve(__dirname, '../public/assets/focus-frames');

// Check if pre-rendered frames are already present
const existingFrames = fs.existsSync(outDir) 
  ? fs.readdirSync(outDir).filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
  : [];

const inputVideo = process.argv[2] || process.env.INPUT_VIDEO;

if (!inputVideo && existingFrames.length > 0) {
  console.log(`[OK] ${existingFrames.length} pre-rendered frames and manifest already exist in: ${outDir}`);
  console.log('[NOTE] Source video files removed to save repository space. To regenerate, run:');
  console.log('       node scripts/build_focus_frames.js <path-to-source-video.mp4>');
  process.exit(0);
}

// 2. Locate ffmpeg
const candidatePaths = [
  process.env.FFMPEG_PATH,
  'ffmpeg'
].filter(Boolean);

let ffmpegPath = null;
for (const p of candidatePaths) {
  try {
    execSync(`"${p}" -version`, { stdio: 'ignore' });
    ffmpegPath = p;
    break;
  } catch (e) {}
}

if (!ffmpegPath) {
  console.error('[ERROR] ffmpeg executable not found in PATH or FFMPEG_PATH environment variable!');
  process.exit(1);
}
console.log('[OK] Using ffmpeg:', ffmpegPath);

if (!inputVideo || !fs.existsSync(inputVideo)) {
  console.error('[ERROR] Valid input video file required: node scripts/build_focus_frames.js <video-path>');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
} else {
  // Clear any old frames
  const files = fs.readdirSync(outDir);
  for (const f of files) {
    if (f.startsWith('frame_') || f === 'manifest.json') {
      fs.unlinkSync(path.join(outDir, f));
    }
  }
}

// 3. Extract frames at ~14 FPS (yielding ~140 crisp frames for a 10s video)
console.log('[EXTRACTING] Extracting ~140 frames at 1280x720 (quality ~82)...');
const outPattern = path.join(outDir, 'frame_%04d.jpg');
const cmd = `"${ffmpegPath}" -y -i "${inputVideo}" -vf "fps=14,scale=1280:720" -q:v 4 "${outPattern}"`;
execSync(cmd, { stdio: 'inherit' });

// 4. Verify & count extracted frames
const frameFiles = fs.readdirSync(outDir).filter(f => f.startsWith('frame_') && f.endsWith('.jpg')).sort();
console.log(`[SUCCESS] Extracted ${frameFiles.length} frames.`);

if (frameFiles.length === 0) {
  console.error('[ERROR] No frames were extracted!');
  process.exit(1);
}

// 5. Write manifest.json
const manifest = {
  totalFrames: frameFiles.length,
  framePrefix: '/assets/focus-frames/frame_',
  frameExt: '.jpg',
  frameDigits: 4,
  width: 1280,
  height: 720,
  firstFrame: `/assets/focus-frames/${frameFiles[0]}`,
  lastFrame: `/assets/focus-frames/${frameFiles[frameFiles.length - 1]}`
};

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('[MANIFEST] Written to:', path.join(outDir, 'manifest.json'));

