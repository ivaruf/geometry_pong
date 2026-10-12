# A ball goes in: a quick bright run up G major and a shimmer on top, with a
# soft thump underneath to land it. The best half-second in the game.
with_fx :reverb, room: 0.6, mix: 0.3 do
  sample :bd_tek, amp: 0.45, rate: 0.9
  with_fx :echo, phase: 0.125, decay: 0.6, mix: 0.18 do
    use_synth :blade
    [:g5, :b5, :d6, :g6].each_with_index do |n, i|
      play n, attack: 0.002, release: 0.22 + i * 0.08, cutoff: 110, amp: 0.38
      sleep 0.055
    end
  end
  synth :pretty_bell, note: :g6, release: 0.7, amp: 0.22
  synth :pretty_bell, note: :d7, release: 0.5, amp: 0.12
end
