# Somebody reached the target: a short fanfare. Three pickup notes, a held
# G major chord on a wide synth, and a sparkle running up over it — about
# three seconds, so it is over before the result card has been read.
use_bpm 132
with_fx :reverb, room: 0.75, mix: 0.35 do
  use_synth :blade
  [[:d5, 0.5], [:g5, 0.5], [:b5, 0.5], [:d6, 0.25]].each do |n, d|
    play n, attack: 0.003, release: d * 0.9, cutoff: 112, amp: 0.4
    sleep d
  end
  sample :bd_tek, amp: 0.5
  synth :supersaw, notes: chord(:g4, :major), attack: 0.02, sustain: 1.2, release: 1.4, cutoff: 100, amp: 0.25
  synth :fm, note: :g2, divisor: 1, depth: 1, attack: 0.01, sustain: 1, release: 1.2, amp: 0.4
  synth :blade, note: :g6, attack: 0.01, sustain: 1.0, release: 1.2, cutoff: 105, amp: 0.25
  sleep 0.75
  use_synth :pretty_bell
  [:g6, :a6, :b6, :d7, :e7, :g7].each_with_index do |n, i|
    play n, release: 0.6, amp: 0.16 - i * 0.015
    sleep 0.125
  end
end
