-- TizCat's own ads ("house ads"), so the whole path works before any
-- advertiser is signed: one New Tab picture and one notification.
INSERT INTO ads (id, placement, advertiser, title, body, image, target_url, weight, created_at) VALUES
  ('house-ntp-1', 'ntp', 'TizCat', 'TizCat Rewards: points for the ads you choose to see',
   '', 'house-ntp-1.jpg', 'https://www.tizcat.com/rewards', 1, 1795003200000),
  ('house-note-1', 'notification', 'TizCat', 'Meet JibWallet, coming to TizCat',
   'Your TizCat Rewards are kept as points until JibWallet is ready.',
   'house-note-1.png', 'https://www.tizcat.com/wallet', 1, 1795003200000);
