# A ball glances off a wall or a sealed side: a soft, dry tick. It fires
# often, so it stays small and pitch-neutral under the hit notes.
with_fx :hpf, cutoff: 70 do
  sample :elec_tick, rate: 1.4, amp: 0.35
  synth :sine, note: :d6, attack: 0, release: 0.035, amp: 0.12
end
