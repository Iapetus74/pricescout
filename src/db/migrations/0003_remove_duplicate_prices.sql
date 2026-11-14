-- The same price reading (same offer, same time) was sometimes saved twice:
-- "Find matches" re-saved pages reused from the short-term cache. The copies
-- showed as duplicate points on the product page. Keep the first of each.
DELETE FROM `price_observations`
WHERE `ok` = 1
  AND `id` NOT IN (
    SELECT MIN(`id`) FROM `price_observations` WHERE `ok` = 1 GROUP BY `offer_id`, `fetched_at`
  );
