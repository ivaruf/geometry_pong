# A ball collects a power-up: a quick upward bloop that lands on a bell —
# "you got something". Rooted on G4 like hit.rb, and played at a playbackRate
# per power-up id (js/audio.js), so each kind has its own note of the same
# G major pentatonic and still sits in the match loop's key.
with_fx :reverb, room: 0.5, mix: 0.28 do
  s = synth :sine, note: :g4, note_slide: 0.09, attack: 0.002, release: 0.22, amp: 0.45
  control s, note: :d5
  synth :tri, note: :g4, attack: 0.002, release: 0.08, amp: 0.2
  sleep 0.08
  synth :pretty_bell, note: :g5, release: 0.45, amp: 0.3
  synth :blade, note: :d6, attack: 0.003, release: 0.25, cutoff: 108, amp: 0.18
  sleep 0.06
  synth :pretty_bell, note: :b5, release: 0.4, amp: 0.16
end
