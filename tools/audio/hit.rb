# A paddle returns the ball: one bright neon "tok". Played at a playbackRate
# per side (js/audio.js), so this single note is every note of the rally's
# tune — G major pentatonic upward from G4. Keep it ONE pitched note: a chord
# or a slide here would turn every side's transposition into mush.
with_fx :reverb, room: 0.3, mix: 0.18 do
  # The body: a clean sine with a touch of FM bell on top.
  synth :sine, note: :g4, attack: 0.002, release: 0.28, amp: 0.55
  synth :fm, note: :g4, divisor: 2, depth: 1.4, attack: 0.001, release: 0.16, amp: 0.4
  # The click of contact: an octave up, gone in 40 ms.
  synth :square, note: :g5, attack: 0, release: 0.04, cutoff: 95, amp: 0.12
end
