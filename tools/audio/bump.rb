# A ball bounces off a bumper: a cartoon "boing" — a sine that springs up
# from D4 to G4 and wobbles. It can fire often, so it is short and softer
# than a paddle hit, and it stays on the key's root and fifth.
with_fx :reverb, room: 0.3, mix: 0.15 do
  s = synth :sine, note: :d4, note_slide: 0.04, attack: 0.002, release: 0.22, amp: 0.4
  control s, note: :g4
  sleep 0.04
  control s, note: :fs4
  sleep 0.04
  control s, note: :g4
  synth :tri, note: :g5, attack: 0.001, release: 0.04, amp: 0.08
end
