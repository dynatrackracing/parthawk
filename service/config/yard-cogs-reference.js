'use strict';

/**
 * COGS reference prices by yard tier.
 * These are the typical register prices at each yard type.
 * Pre-populates the COGS field for each part — puller can override.
 *
 * Update this file when yard pricing changes.
 */

const LKQ_COGS = {
  ECM:        { cogs: 40,  label: 'ECM/PCM/ECU' },
  BCM:        { cogs: 28,  label: 'BCM' },
  TCM:        { cogs: 50,  label: 'TCM/TCU' },
  ABS:        { cogs: 75,  label: 'ABS Module + Pump' },
  TIPM:       { cogs: 35,  label: 'Fuse Box / TIPM' },
  Amplifier:  { cogs: 20,  label: 'Amplifier' },
  Radio:      { cogs: 28,  label: 'Radio / Head Unit' },
  Cluster:    { cogs: 32,  label: 'Instrument Cluster' },
  Throttle:   { cogs: 36,  label: 'Throttle Body' },
  Steering:   { cogs: 35,  label: 'Steering Column / EPS' },
  Mirror:     { cogs: 25,  label: 'Side Mirror' },
  SeatBelt:   { cogs: 13,  label: 'Seat Belt' },
  WindowMotor:{ cogs: 22,  label: 'Window Motor / Regulator' },
  YawSensor:  { cogs: 18,  label: 'Yaw Rate Sensor' },
  Camera:     { cogs: 15,  label: 'Backup Camera' },
  Blower:     { cogs: 22,  label: 'Blower Motor' },
  Other:      { cogs: 30,  label: 'Other' },
};

const INDEPENDENT_COGS = {
  ECM:        { cogs: 30,  label: 'ECM/PCM/ECU' },
  BCM:        { cogs: 20,  label: 'BCM' },
  TCM:        { cogs: 70,  label: 'TCM/TCU' },
  ABS:        { cogs: 55,  label: 'ABS Module + Pump' },
  TIPM:       { cogs: 26,  label: 'Fuse Box / TIPM' },
  Amplifier:  { cogs: 16,  label: 'Amplifier' },
  Radio:      { cogs: 20,  label: 'Radio / Head Unit' },
  Cluster:    { cogs: 25,  label: 'Instrument Cluster' },
  Throttle:   { cogs: 28,  label: 'Throttle Body' },
  Steering:   { cogs: 28,  label: 'Steering Column / EPS' },
  Mirror:     { cogs: 20,  label: 'Side Mirror' },
  SeatBelt:   { cogs: 10,  label: 'Seat Belt' },
  WindowMotor:{ cogs: 18,  label: 'Window Motor / Regulator' },
  YawSensor:  { cogs: 15,  label: 'Yaw Rate Sensor' },
  Camera:     { cogs: 12,  label: 'Backup Camera' },
  Blower:     { cogs: 18,  label: 'Blower Motor' },
  Other:      { cogs: 25,  label: 'Other' },
};

// Default market values (eBay avg sell prices) for quick estimates
const DEFAULT_MARKET_VALUES = {
  ECM: 180, BCM: 120, TCM: 130, ABS: 250, TIPM: 150,
  Amplifier: 85, Radio: 65, Cluster: 75, Throttle: 95,
  Steering: 120, Mirror: 55, SeatBelt: 35, WindowMotor: 50,
  YawSensor: 60, Camera: 45, Blower: 50, Other: 50,
};

// Map chain name to tier
function getTierForChain(chain) {
  const c = (chain || '').toLowerCase();
  if (c.includes('lkq') || c.includes('pull-a-part') || c.includes('pull a part')) return 'lkq';
  return 'independent';
}

function getCogsReference(chain) {
  return getTierForChain(chain) === 'lkq' ? LKQ_COGS : INDEPENDENT_COGS;
}

module.exports = {
  LKQ_COGS, INDEPENDENT_COGS, DEFAULT_MARKET_VALUES,
  getTierForChain, getCogsReference,
};
