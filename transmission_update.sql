-- Add transmission column to trim_tier_reference
ALTER TABLE trim_tier_reference ADD COLUMN IF NOT EXISTS transmission text;

-- Apply transmission data in order (later updates override earlier ones)

-- Rule 1
UPDATE trim_tier_reference SET transmission = 'Automatic' WHERE 1=1;

-- Rule 2
UPDATE trim_tier_reference SET transmission = 'CVT' WHERE LOWER(make) = 'nissan' AND LOWER(model) IN ('altima', 'sentra', 'versa', 'rogue', 'murano', 'pathfinder', 'maxima', 'quest') AND gen_start >= 2007 AND tier <= 2;

-- Rule 3
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'nissan' AND LOWER(trim) LIKE '%se-r%';

-- Rule 4
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'nissan' AND LOWER(trim) LIKE '%spec v%';

-- Rule 5
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'nissan' AND LOWER(trim) = 'nismo' AND LOWER(model) = 'sentra';

-- Rule 6
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'nissan' AND LOWER(model) = '350z' AND LOWER(trim) IN ('enthusiast', 'track', 'nismo');

-- Rule 7
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'nissan' AND LOWER(model) = '370z' AND LOWER(trim) IN ('base', 'sport', 'nismo');

-- Rule 8
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'nissan' AND LOWER(model) = '240sx';

-- Rule 9
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'nissan' AND LOWER(model) = '300zx';

-- Rule 10
UPDATE trim_tier_reference SET transmission = '6-speed DCT' WHERE LOWER(make) = 'nissan' AND LOWER(model) = 'gt-r';

-- Rule 11
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'nissan' AND LOWER(model) = 'frontier' AND LOWER(trim) LIKE '%pro-4x%';

-- Rule 12
UPDATE trim_tier_reference SET transmission = 'CVT' WHERE LOWER(make) = 'subaru' AND LOWER(model) = 'outback' AND gen_start >= 2010 AND tier <= 2;

-- Rule 13
UPDATE trim_tier_reference SET transmission = 'CVT' WHERE LOWER(make) = 'subaru' AND LOWER(model) = 'forester' AND gen_start >= 2014 AND tier <= 2;

-- Rule 14
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'subaru' AND LOWER(model) = 'wrx' AND LOWER(trim) NOT LIKE '%sti%';

-- Rule 15
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'subaru' AND LOWER(model) = 'wrx' AND LOWER(trim) LIKE '%sti%';

-- Rule 16
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'subaru' AND LOWER(model) = 'wrx' AND gen_start < 2008;

-- Rule 17
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'subaru' AND LOWER(model) = 'brz';

-- Rule 18
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'subaru' AND LOWER(model) = 'forester' AND LOWER(trim) LIKE '%xt%' AND gen_start < 2014;

-- Rule 19
UPDATE trim_tier_reference SET transmission = 'CVT' WHERE LOWER(make) = 'honda' AND LOWER(model) = 'civic' AND gen_start >= 2014 AND tier <= 2;

-- Rule 20
UPDATE trim_tier_reference SET transmission = 'CVT' WHERE LOWER(make) = 'honda' AND LOWER(model) = 'cr-v' AND gen_start >= 2015;

-- Rule 21
UPDATE trim_tier_reference SET transmission = 'CVT' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'corolla' AND gen_start >= 2014 AND LOWER(trim) NOT IN ('xrs') AND tier <= 2;

-- Rule 22
UPDATE trim_tier_reference SET transmission = 'CVT' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'prius';

-- Rule 23
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) IN ('ram', 'dodge') AND LOWER(model) LIKE '%1500%' AND gen_start >= 2013;

-- Rule 24
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) IN ('ram', 'dodge') AND LOWER(model) LIKE '%2500%' AND gen_start >= 2019;

-- Rule 25
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) IN ('ram', 'dodge') AND LOWER(model) LIKE '%2500%' AND gen_start >= 2007 AND gen_end <= 2018;

-- Rule 26
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) IN ('ram', 'dodge') AND LOWER(model) LIKE '%1500%' AND gen_start >= 2009 AND gen_end <= 2012;

-- Rule 27
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'dodge' AND LOWER(model) = 'ram 1500' AND gen_start >= 2002 AND gen_end <= 2008;

-- Rule 28
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'dodge' AND LOWER(model) = 'ram 1500' AND gen_start < 2002;

-- Rule 29
UPDATE trim_tier_reference SET transmission = '10-speed Automatic' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'f-150' AND gen_start >= 2017;

-- Rule 30
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'f-150' AND gen_start >= 2009 AND gen_end <= 2016;

-- Rule 31
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'f-150' AND gen_start >= 2004 AND gen_end <= 2008;

-- Rule 32
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'f-150' AND gen_end <= 2003;

-- Rule 33
UPDATE trim_tier_reference SET transmission = '10-speed Automatic' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'explorer' AND gen_start >= 2020;

-- Rule 34
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'explorer' AND gen_start >= 2011 AND gen_end <= 2019;

-- Rule 35
UPDATE trim_tier_reference SET transmission = '10-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc') AND LOWER(model) LIKE '%silverado%' AND gen_start >= 2019;

-- Rule 36
UPDATE trim_tier_reference SET transmission = '10-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc') AND LOWER(model) LIKE '%sierra%' AND gen_start >= 2019;

-- Rule 37
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc') AND LOWER(model) LIKE '%silverado%' AND gen_start >= 2014 AND gen_end <= 2018;

-- Rule 38
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc') AND LOWER(model) LIKE '%sierra%' AND gen_start >= 2014 AND gen_end <= 2018;

-- Rule 39
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc') AND LOWER(model) LIKE '%silverado%' AND gen_start >= 2007 AND gen_end <= 2013;

-- Rule 40
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc') AND LOWER(model) LIKE '%sierra%' AND gen_start >= 2007 AND gen_end <= 2013;

-- Rule 41
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc') AND LOWER(model) LIKE '%silverado%' AND gen_end <= 2006;

-- Rule 42
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc') AND LOWER(model) LIKE '%sierra%' AND gen_end <= 2006;

-- Rule 43
UPDATE trim_tier_reference SET transmission = '10-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc', 'cadillac') AND LOWER(model) IN ('tahoe', 'yukon', 'yukon xl', 'suburban', 'escalade') AND gen_start >= 2019;

-- Rule 44
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc', 'cadillac') AND LOWER(model) IN ('tahoe', 'yukon', 'yukon xl', 'suburban', 'escalade') AND gen_start >= 2015 AND gen_end <= 2020;

-- Rule 45
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc', 'cadillac') AND LOWER(model) IN ('tahoe', 'yukon', 'yukon xl', 'suburban', 'escalade') AND gen_start >= 2007 AND gen_end <= 2014;

-- Rule 46
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) IN ('chevrolet', 'gmc', 'cadillac') AND LOWER(model) IN ('tahoe', 'yukon', 'yukon xl', 'suburban', 'escalade') AND gen_end <= 2006;

-- Rule 47
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'toyota' AND LOWER(model) IN ('tacoma', '4runner', 'tundra', 'fj cruiser', 'land cruiser') AND gen_start >= 2005;

-- Rule 48
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'tundra' AND gen_start >= 2007;

-- Rule 49
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'tacoma' AND gen_start >= 2016;

-- Rule 50
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'land cruiser' AND gen_start >= 2008;

-- Rule 51
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'pickup';

-- Rule 52
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'grand cherokee' AND gen_start >= 2014;

-- Rule 53
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'grand cherokee' AND gen_start >= 2005 AND gen_end <= 2013;

-- Rule 54
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'grand cherokee' AND gen_end <= 2004;

-- Rule 55
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'wrangler' AND gen_start >= 2018;

-- Rule 56
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'wrangler' AND gen_start >= 2007 AND gen_end <= 2017;

-- Rule 57
UPDATE trim_tier_reference SET transmission = '9-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'cherokee' AND gen_start >= 2014;

-- Rule 58
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'liberty';

-- Rule 59
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'dodge' AND LOWER(model) IN ('charger', 'challenger') AND gen_start >= 2015;

-- Rule 60
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'dodge' AND LOWER(model) IN ('charger', 'challenger') AND gen_start >= 2011 AND gen_end <= 2014;

-- Rule 61
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'dodge' AND LOWER(model) = 'charger' AND gen_end <= 2010;

-- Rule 62
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'dodge' AND LOWER(model) = 'durango' AND gen_start >= 2014;

-- Rule 63
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'chrysler' AND LOWER(model) = '300' AND gen_start >= 2012;

-- Rule 64
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'chrysler' AND LOWER(model) = '300' AND gen_end <= 2011;

-- Rule 65
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'honda' AND LOWER(trim) IN ('si', 'type r');

-- Rule 66
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'honda' AND LOWER(model) = 'civic' AND LOWER(trim) = 'si' AND gen_start < 2006;

-- Rule 67
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'honda' AND LOWER(model) = 's2000';

-- Rule 68
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'honda' AND LOWER(model) = 'prelude';

-- Rule 69
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'acura' AND LOWER(model) = 'integra' AND LOWER(trim) IN ('gs-r', 'type r');

-- Rule 70
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'acura' AND LOWER(model) = 'rsx' AND LOWER(trim) = 'type-s';

-- Rule 71
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'acura' AND LOWER(trim) = 'type s' AND LOWER(model) = 'tlx';

-- Rule 72
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'supra' AND LOWER(trim) = 'turbo';

-- Rule 73
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'supra' AND gen_start >= 2020;

-- Rule 74
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'mr2' AND LOWER(trim) = 'turbo';

-- Rule 75
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'celica' AND LOWER(trim) LIKE '%gt-four%';

-- Rule 76
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'corolla' AND LOWER(trim) = 'xrs';

-- Rule 77
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'corolla' AND LOWER(trim) LIKE '%gr%';

-- Rule 78
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) = 'gr86';

-- Rule 79
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) = '86';

-- Rule 80
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'toyota' AND LOWER(model) IN ('tacoma', '4runner') AND LOWER(trim) LIKE '%trd pro%';

-- Rule 81
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'mustang' AND LOWER(trim) IN ('gt', 'shelby gt350', 'shelby gt500', 'cobra', 'cobra r', 'mach 1') AND gen_end <= 2014;

-- Rule 82
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'mustang' AND LOWER(trim) IN ('shelby gt350') AND gen_start >= 2015;

-- Rule 83
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'mustang' AND LOWER(trim) = 'shelby gt500' AND gen_start >= 2020;

-- Rule 84
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'focus' AND LOWER(trim) = 'svt';

-- Rule 85
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'focus' AND LOWER(trim) = 'st';

-- Rule 86
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'focus' AND LOWER(trim) = 'rs';

-- Rule 87
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'fiesta' AND LOWER(trim) = 'st';

-- Rule 88
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'ford' AND LOWER(model) = 'f-150' AND LOWER(trim) = 'lightning' AND gen_end <= 1999;

-- Rule 89
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'chevrolet' AND LOWER(model) = 'camaro' AND LOWER(trim) IN ('z28', 'ss') AND gen_end <= 2002;

-- Rule 90
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'chevrolet' AND LOWER(model) = 'camaro' AND LOWER(trim) IN ('ss', 'zl1', 'z/28') AND gen_start >= 2010;

-- Rule 91
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'chevrolet' AND LOWER(model) = 'corvette' AND LOWER(trim) IN ('z06') AND gen_end <= 2013;

-- Rule 92
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'chevrolet' AND LOWER(model) = 'cobalt' AND LOWER(trim) = 'ss';

-- Rule 93
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'chevrolet' AND LOWER(model) = 'trailblazer' AND LOWER(trim) = 'ss';

-- Rule 94
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'dodge' AND LOWER(trim) LIKE '%hellcat%';

-- Rule 95
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'dodge' AND LOWER(trim) LIKE '%demon%';

-- Rule 96
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'dodge' AND LOWER(model) = 'viper';

-- Rule 97
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'ram' AND LOWER(trim) = 'trx';

-- Rule 98
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'mitsubishi' AND LOWER(model) = 'eclipse' AND LOWER(trim) IN ('gs-t', 'gsx');

-- Rule 99
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'mitsubishi' AND LOWER(trim) LIKE '%evolution%gsr%';

-- Rule 100
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'mitsubishi' AND LOWER(trim) LIKE '%evolution viii%';

-- Rule 101
UPDATE trim_tier_reference SET transmission = '6-speed DCT' WHERE LOWER(make) = 'mitsubishi' AND LOWER(trim) LIKE '%evolution%mr%';

-- Rule 102
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'bmw' AND LOWER(trim) = 'm3' AND gen_end <= 2018;

-- Rule 103
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'bmw' AND LOWER(trim) = 'm3' AND gen_start >= 2019;

-- Rule 104
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'bmw' AND LOWER(trim) = 'm5' AND gen_end <= 2003;

-- Rule 105
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'bmw' AND LOWER(trim) = 'm5' AND gen_start >= 2006;

-- Rule 106
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'bmw' AND LOWER(trim) = 'm5' AND gen_start >= 2012;

-- Rule 107
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'volkswagen' AND LOWER(trim) = 'gli' AND gen_start >= 2006;

-- Rule 108
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'volkswagen' AND LOWER(model) = 'golf r';

-- Rule 109
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'volkswagen' AND LOWER(model) = 'golf r' AND gen_start >= 2022;

-- Rule 110
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'volkswagen' AND LOWER(model) LIKE '%golf gti%' AND gen_start >= 2006;

-- Rule 111
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'volkswagen' AND LOWER(model) = 'passat' AND LOWER(trim) = 'w8';

-- Rule 112
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'mazda' AND LOWER(model) = 'rx-7';

-- Rule 113
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'mazda' AND LOWER(model) = 'rx-8';

-- Rule 114
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'mazda' AND LOWER(model) = 'miata';

-- Rule 115
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'mazda' AND LOWER(model) = 'mx-5 miata';

-- Rule 116
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'mazda' AND LOWER(model) = 'mazdaspeed3';

-- Rule 117
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'mazda' AND LOWER(model) = 'mazdaspeed6';

-- Rule 118
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) = 'mazda' AND LOWER(model) = 'mazda3' AND LOWER(trim) = 'turbo';

-- Rule 119
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'audi' AND LOWER(trim) LIKE '%s4%' AND gen_start >= 2009;

-- Rule 120
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'audi' AND LOWER(trim) LIKE '%s5%';

-- Rule 121
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'audi' AND LOWER(trim) LIKE '%rs5%';

-- Rule 122
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'audi' AND LOWER(trim) LIKE '%rs6%';

-- Rule 123
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'audi' AND LOWER(trim) LIKE '%tt rs%';

-- Rule 124
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'audi' AND LOWER(trim) = 'r8' OR (LOWER(make) = 'audi' AND LOWER(model) = 'r8');

-- Rule 125
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'audi' AND LOWER(trim) LIKE '%s4%' AND gen_end <= 2008;

-- Rule 126
UPDATE trim_tier_reference SET transmission = '7-speed Automatic' WHERE LOWER(make) = 'mercedes-benz' AND LOWER(trim) LIKE '%c63%' AND gen_end <= 2014;

-- Rule 127
UPDATE trim_tier_reference SET transmission = '9-speed Automatic' WHERE LOWER(make) = 'mercedes-benz' AND LOWER(trim) LIKE '%c63%' AND gen_start >= 2015;

-- Rule 128
UPDATE trim_tier_reference SET transmission = '9-speed Automatic' WHERE LOWER(make) = 'mercedes-benz' AND LOWER(trim) LIKE '%e63%';

-- Rule 129
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'mercedes-benz' AND LOWER(trim) LIKE '%c32%';

-- Rule 130
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'mercedes-benz' AND LOWER(trim) LIKE '%c55%';

-- Rule 131
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'mercedes-benz' AND LOWER(trim) LIKE '%e55%';

-- Rule 132
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'mercedes-benz' AND LOWER(trim) LIKE '%ml55%';

-- Rule 133
UPDATE trim_tier_reference SET transmission = '7-speed Automatic' WHERE LOWER(make) = 'infiniti' AND LOWER(trim) LIKE '%red sport%';

-- Rule 134
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'infiniti' AND LOWER(model) = 'g35' AND LOWER(trim) = 'sport';

-- Rule 135
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'infiniti' AND LOWER(model) = 'g37' AND LOWER(trim) = 'sport';

-- Rule 136
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'lexus' AND LOWER(model) = 'is' AND LOWER(trim) = 'is f';

-- Rule 137
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'lexus' AND LOWER(model) = 'gs' AND LOWER(trim) = 'gs f';

-- Rule 138
UPDATE trim_tier_reference SET transmission = '5-speed Automatic' WHERE LOWER(make) = 'lexus' AND LOWER(model) = 'is' AND LOWER(trim) = 'is 300' AND gen_end <= 2005;

-- Rule 139
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'cadillac' AND LOWER(trim) LIKE '%cts-v%' AND gen_end <= 2007;

-- Rule 140
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'cadillac' AND LOWER(trim) LIKE '%cts-v%' AND gen_start >= 2008 AND gen_end <= 2013;

-- Rule 141
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'cadillac' AND LOWER(trim) LIKE '%cts-v%' AND gen_start >= 2016;

-- Rule 142
UPDATE trim_tier_reference SET transmission = '10-speed Automatic' WHERE LOWER(make) = 'cadillac' AND LOWER(trim) = 'escalade v';

-- Rule 143
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'hyundai' AND LOWER(trim) = 'n' AND LOWER(model) = 'veloster';

-- Rule 144
UPDATE trim_tier_reference SET transmission = '8-speed DCT' WHERE LOWER(make) = 'hyundai' AND LOWER(trim) = 'n line' AND LOWER(model) = 'sonata';

-- Rule 145
UPDATE trim_tier_reference SET transmission = '7-speed DCT' WHERE LOWER(make) = 'kia' AND LOWER(trim) = 'gt' AND LOWER(model) IN ('k5', 'forte');

-- Rule 146
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) = 'lincoln';

-- Rule 147
UPDATE trim_tier_reference SET transmission = '10-speed Automatic' WHERE LOWER(make) = 'lincoln' AND LOWER(model) = 'navigator' AND gen_start >= 2018;

-- Rule 148
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'lincoln' AND LOWER(model) = 'town car';

-- Rule 149
UPDATE trim_tier_reference SET transmission = '6-speed Automatic' WHERE LOWER(make) = 'buick';

-- Rule 150
UPDATE trim_tier_reference SET transmission = '4-speed Automatic' WHERE LOWER(make) = 'buick' AND LOWER(model) = 'lesabre';

-- Rule 151
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'wrangler' AND LOWER(trim) IN ('sport', 'rubicon') AND gen_start >= 2018;

-- Rule 152
UPDATE trim_tier_reference SET transmission = '6-speed Manual' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'wrangler' AND gen_start >= 2007 AND gen_end <= 2017;

-- Rule 153
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'wrangler' AND gen_end <= 2006;

-- Rule 154
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'wrangler' AND LOWER(trim) LIKE '%rubicon 392%';

-- Rule 155
UPDATE trim_tier_reference SET transmission = '8-speed Automatic' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'wrangler' AND LOWER(trim) = 'sahara' AND gen_start >= 2018;

-- Rule 156
UPDATE trim_tier_reference SET transmission = '5-speed Manual' WHERE LOWER(make) = 'jeep' AND LOWER(model) = 'cherokee' AND gen_end <= 2001;

-- Verify distribution
SELECT transmission, count(*) as cnt FROM trim_tier_reference GROUP BY transmission ORDER BY cnt DESC;

-- Show manual/DCT entries for spot check
SELECT make, model, trim, tier_name, transmission FROM trim_tier_reference WHERE transmission NOT IN ('Automatic', 'CVT') AND transmission NOT LIKE '%Automatic%' ORDER BY make, model, gen_start;