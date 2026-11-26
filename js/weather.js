/** Open-Meteo payload → the temperature and rain flag the outfit engine uses. */

export function forecastFromMeteo(data) {
  const current = data?.current || {};
  const daily = data?.daily || {};
  const raw = current.apparent_temperature ?? current.temperature_2m ?? daily.apparent_temperature_mean?.[0];
  const temp = Number(raw);
  if (!Number.isFinite(temp)) return null;
  const probability = Math.max(
    Number(current.precipitation_probability) || 0,
    Number(daily.precipitation_probability_max?.[0]) || 0
  );
  const millimeters = Math.max(
    Number(current.precipitation) || 0,
    Number(daily.precipitation_sum?.[0]) || 0
  );
  return {
    tempC: Math.round(temp),
    rain: probability >= 40 || millimeters >= 1,
  };
}
