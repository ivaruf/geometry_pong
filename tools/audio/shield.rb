# A shield turns a goal away: a bright metallic clang on G with a zap of
# static over it — the sound of a door slammed in the ball's face. Short, so
# the rebound that follows is heard as its own hit.
with_fx :reverb, room: 0.55, mix: 0.25 do
  sample :bd_tek, amp: 0.35, rate: 1.1
  # The clang: inharmonic FM on G3 and an octave bell above it.
  synth :fm, note: :g3, divisor: 1.41, depth: 4, attack: 0.001, release: 0.45, amp: 0.4
  synth :pretty_bell, note: :g5, release: 0.35, amp: 0.22
  # The zap: a falling saw and a burst of filtered noise.
  with_fx :hpf, cutoff: 80 do
    synth :bnoise, attack: 0.001, release: 0.08, amp: 0.25
  end
  z = synth :saw, note: :g6, note_slide: 0.12, attack: 0.001, release: 0.14, cutoff: 105, amp: 0.15
  control z, note: :g4
end
