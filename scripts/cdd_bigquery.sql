-- TTM: daily Bitcoin coin days destroyed (CDD), computed from the public blockchain dataset in Google BigQuery.
-- Run once in the BigQuery console, then download the result as CSV (columns: day, cdd).
-- For every coin spent, CDD = amount in BTC x days since that coin was created. Coinbase (new coins) is excluded, as it has no age.
SELECT
  DATE(i.block_timestamp) AS day,
  SUM(i.value / 1e8 * TIMESTAMP_DIFF(i.block_timestamp, o.block_timestamp, SECOND) / 86400) AS cdd
FROM `bigquery-public-data.crypto_bitcoin.inputs` AS i
JOIN `bigquery-public-data.crypto_bitcoin.outputs` AS o
  ON i.spent_transaction_hash = o.transaction_hash AND i.spent_output_index = o.index
GROUP BY day
ORDER BY day
