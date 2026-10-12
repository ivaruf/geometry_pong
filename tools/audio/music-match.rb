# geometry_pong match loop: "Neon rally". 120 bpm, a 64-beat (32 s) loop
# played twice; encode.mjs keeps only the second pass, which already carries
# the first pass's reverb and echo tails, so the seam is seamless.
# Marker tick first; the loop starts one beat (0.5 s) after it.
#
# E minor / G major, so every hit note (G major pentatonic, see hit.rb) sits
# inside it whatever side returns the ball. Kept mid-energy and thin in the
# hit cue's register (G4–B5): bass, pad and a soft low arp, so the rally's
# tune is the melody.
use_bpm 120
use_random_seed 11
sample :elec_tick, amp: 1.4
sleep 1
roots = [:e2, :c2, :g2, :d2]
chords = [chord(:e3, :minor7), chord(:c3, :major7), chord(:g3, :add9), chord(:d3, :sus4)]
arps = [chord(:e4, :minor, num_octaves: 2), chord(:c4, :major, num_octaves: 2),
        chord(:g3, :major, num_octaves: 2), chord(:d4, :sus4, num_octaves: 2)]
shape = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 5, 3, 2, 1]
# Drums: kick on 1 and 3 throughout, offbeat hats, a soft snare in the back half.
in_thread do
  with_fx :lpf, cutoff: 110 do
    2.times do
      16.times do |bar|
        4.times do |beat|
          sample :bd_tek, amp: 0.55 if beat.even?
          sample :sn_dub, amp: 0.18, rate: 1.1 if beat.odd? && bar >= 8
          sample :drum_cymbal_closed, amp: 0.06, rate: 1.4
          sleep 0.5
          sample :drum_cymbal_closed, amp: 0.13, rate: 1.6
          sleep 0.5
        end
        sample :elec_blip2, amp: 0.12, rate: 1.5 if bar % 4 == 3
      end
    end
  end
end
# Bass: eighth notes on the root, octave pops on the off-beats.
in_thread do
  with_fx :lpf, cutoff: 78 do
    use_synth :fm
    2.times do
      2.times do
        roots.each do |r|
          16.times do |i|
            n = (i % 4 == 3) ? r + 12 : r
            play n, divisor: 2, depth: 1.1, attack: 0.005, release: 0.3, amp: (i.even? ? 0.6 : 0.4)
            sleep 0.5
          end
        end
      end
    end
  end
end
# Arp: soft triangle, up and down each chord in eighths, echoed and panned.
in_thread do
  with_fx :reverb, room: 0.6, mix: 0.35 do
    with_fx :echo, phase: 0.75, decay: 2, mix: 0.18 do
      use_synth :tri
      2.times do
        2.times do |half|
          arps.each do |c|
            shape.each_with_index do |idx, i|
              play c[idx], attack: 0.005, release: 0.25, amp: (half == 0 ? 0.16 : 0.22),
                   pan: (i.even? ? -0.35 : 0.35)
              sleep 0.5
            end
          end
        end
      end
    end
  end
end
# Pad: one chord per two bars, slow attack, wide.
in_thread do
  with_fx :reverb, room: 0.85, mix: 0.5 do
    use_synth :prophet
    2.times do
      2.times do
        chords.each do |c|
          play c, attack: 1.5, sustain: 5, release: 2.5, cutoff: 80, amp: 0.22
          sleep 8
        end
      end
    end
  end
end
