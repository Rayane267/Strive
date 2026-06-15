-- ═══════════════════════════════════════════════════════════════════════════
-- vehicles_db — catalogue marques/modèles potentiellement éligibles VTC (FR/EU)
-- ═══════════════════════════════════════════════════════════════════════════
-- Alimente le sélecteur marque/modèle de CarSettingsScreen
-- (select make / select model where make=...).
--
-- Idempotent : insère chaque couple (make, model) uniquement s'il n'existe pas
-- déjà → ré-exécutable sans créer de doublon, sans dépendre d'une contrainte
-- unique sur la table (créée à la main dans le Dashboard).
--
-- Périmètre : large (« le maximum »). Berlines, breaks, SUV, monospaces, vans
-- et électriques couramment utilisés ou utilisables en VTC. Les vraies règles
-- d'éligibilité VTC (4-9 places, dimensions, âge, puissance) restent à la
-- charge du chauffeur — ce catalogue ne filtre pas, il propose.
--
-- NAMING : orthographes alignées sur l'existant (catalogue du 2026-06-12) —
--    'Citroen' (sans tréma) et 'DS Automobiles'. Les couples déjà présents
--    (Audi A7, BMW X3, Tesla Model 3…) sont ignorés par le NOT EXISTS.
--    Note : ce seed peut créer des entrées « génériques » à côté des variantes
--    suffixées existantes (ex. 'Kona' ajouté alors que 'Kona Electric' existe).
--    C'est volontaire (« le maximum »). Pour fusionner, voir requête en bas.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.vehicles_db (make, model)
select v.make, v.model
from (values
  -- ─── Mercedes-Benz ───
  ('Mercedes-Benz','Classe A'),('Mercedes-Benz','Classe B'),('Mercedes-Benz','Classe C'),
  ('Mercedes-Benz','Classe C Break'),('Mercedes-Benz','Classe E'),('Mercedes-Benz','Classe E Break'),
  ('Mercedes-Benz','Classe S'),('Mercedes-Benz','CLA'),('Mercedes-Benz','CLS'),
  ('Mercedes-Benz','GLA'),('Mercedes-Benz','GLB'),('Mercedes-Benz','GLC'),('Mercedes-Benz','GLE'),
  ('Mercedes-Benz','GLS'),('Mercedes-Benz','EQA'),('Mercedes-Benz','EQB'),('Mercedes-Benz','EQC'),
  ('Mercedes-Benz','EQE'),('Mercedes-Benz','EQS'),('Mercedes-Benz','EQV'),('Mercedes-Benz','Classe V'),
  ('Mercedes-Benz','Vito'),('Mercedes-Benz','Citan'),
  -- ─── BMW ───
  ('BMW','Série 1'),('BMW','Série 2 Active Tourer'),('BMW','Série 2 Gran Coupé'),('BMW','Série 3'),
  ('BMW','Série 3 Touring'),('BMW','Série 4 Gran Coupé'),('BMW','Série 5'),('BMW','Série 5 Touring'),
  ('BMW','Série 6 GT'),('BMW','Série 7'),('BMW','Série 8 Gran Coupé'),('BMW','X1'),('BMW','X2'),
  ('BMW','X3'),('BMW','X4'),('BMW','X5'),('BMW','X6'),('BMW','X7'),('BMW','i4'),('BMW','i5'),
  ('BMW','i7'),('BMW','iX1'),('BMW','iX2'),('BMW','iX3'),('BMW','iX'),
  -- ─── Audi ───
  ('Audi','A1'),('Audi','A3'),('Audi','A3 Sportback'),('Audi','A4'),('Audi','A4 Avant'),
  ('Audi','A5 Sportback'),('Audi','A6'),('Audi','A6 Avant'),('Audi','A7'),('Audi','A8'),
  ('Audi','Q2'),('Audi','Q3'),('Audi','Q4 e-tron'),('Audi','Q5'),('Audi','Q7'),('Audi','Q8'),
  ('Audi','e-tron'),('Audi','e-tron GT'),('Audi','Q6 e-tron'),
  -- ─── Volkswagen ───
  ('Volkswagen','Polo'),('Volkswagen','Golf'),('Volkswagen','Passat'),('Volkswagen','Passat SW'),
  ('Volkswagen','Arteon'),('Volkswagen','Touran'),('Volkswagen','Tiguan'),('Volkswagen','T-Roc'),
  ('Volkswagen','T-Cross'),('Volkswagen','Sharan'),('Volkswagen','Touareg'),('Volkswagen','ID.3'),
  ('Volkswagen','ID.4'),('Volkswagen','ID.5'),('Volkswagen','ID.7'),('Volkswagen','ID. Buzz'),
  ('Volkswagen','Caddy'),('Volkswagen','Multivan'),
  -- ─── Tesla ───
  ('Tesla','Model 3'),('Tesla','Model S'),('Tesla','Model X'),('Tesla','Model Y'),
  -- ─── Peugeot ───
  ('Peugeot','208'),('Peugeot','308'),('Peugeot','308 SW'),('Peugeot','408'),('Peugeot','508'),
  ('Peugeot','508 SW'),('Peugeot','2008'),('Peugeot','3008'),('Peugeot','5008'),('Peugeot','e-208'),
  ('Peugeot','e-2008'),('Peugeot','e-308'),('Peugeot','e-3008'),('Peugeot','Rifter'),
  ('Peugeot','Traveller'),
  -- ─── Citroen ─── (orthographe alignée sur la table : sans tréma)
  ('Citroen','C3'),('Citroen','C3 Aircross'),('Citroen','C4'),('Citroen','C4 X'),('Citroen','e-C4'),
  ('Citroen','C5 X'),('Citroen','C5 Aircross'),('Citroen','Berlingo'),('Citroen','SpaceTourer'),
  ('Citroen','Grand C4 SpaceTourer'),
  -- ─── DS Automobiles ─── (nom aligné sur la table)
  ('DS Automobiles','DS 3'),('DS Automobiles','DS 4'),('DS Automobiles','DS 7'),('DS Automobiles','DS 9'),
  -- ─── Renault ───
  ('Renault','Clio'),('Renault','Mégane'),('Renault','Mégane E-Tech'),('Renault','Talisman'),
  ('Renault','Arkana'),('Renault','Captur'),('Renault','Kadjar'),('Renault','Austral'),
  ('Renault','Espace'),('Renault','Scénic'),('Renault','Grand Scénic'),('Renault','Scénic E-Tech'),
  ('Renault','Koleos'),('Renault','Zoe'),('Renault','Trafic'),('Renault','Rafale'),
  ('Renault','Symbioz'),
  -- ─── Dacia ───
  ('Dacia','Logan'),('Dacia','Sandero'),('Dacia','Jogger'),('Dacia','Duster'),('Dacia','Lodgy'),
  ('Dacia','Spring'),
  -- ─── Toyota ───
  ('Toyota','Yaris'),('Toyota','Corolla'),('Toyota','Corolla Touring Sports'),('Toyota','Camry'),
  ('Toyota','Prius'),('Toyota','C-HR'),('Toyota','RAV4'),('Toyota','Highlander'),
  ('Toyota','Proace Verso'),('Toyota','bZ4X'),('Toyota','Auris'),('Toyota','Verso'),
  -- ─── Hyundai ───
  ('Hyundai','i20'),('Hyundai','i30'),('Hyundai','Ioniq'),('Hyundai','Ioniq 5'),('Hyundai','Ioniq 6'),
  ('Hyundai','Kona'),('Hyundai','Tucson'),('Hyundai','Santa Fe'),('Hyundai','Bayon'),('Hyundai','i40'),
  -- ─── Kia ───
  ('Kia','Ceed'),('Kia','Ceed SW'),('Kia','Rio'),('Kia','Stinger'),('Kia','Niro'),('Kia','EV6'),
  ('Kia','EV9'),('Kia','Sportage'),('Kia','Sorento'),('Kia','XCeed'),('Kia','ProCeed'),
  -- ─── Škoda ───
  ('Škoda','Fabia'),('Škoda','Octavia'),('Škoda','Octavia Combi'),('Škoda','Scala'),
  ('Škoda','Superb'),('Škoda','Superb Combi'),('Škoda','Kamiq'),('Škoda','Karoq'),
  ('Škoda','Kodiaq'),('Škoda','Enyaq'),
  -- ─── Seat / Cupra ───
  ('Seat','Ibiza'),('Seat','Leon'),('Seat','Leon ST'),('Seat','Arona'),('Seat','Ateca'),
  ('Seat','Tarraco'),('Seat','Alhambra'),
  ('Cupra','Leon'),('Cupra','Formentor'),('Cupra','Born'),('Cupra','Tavascan'),('Cupra','Ateca'),
  -- ─── Volvo ───
  ('Volvo','S60'),('Volvo','S90'),('Volvo','V60'),('Volvo','V90'),('Volvo','XC40'),('Volvo','XC60'),
  ('Volvo','XC90'),('Volvo','C40'),('Volvo','EX30'),('Volvo','EX90'),
  -- ─── Ford ───
  ('Ford','Fiesta'),('Ford','Focus'),('Ford','Mondeo'),('Ford','Kuga'),('Ford','Puma'),
  ('Ford','S-Max'),('Ford','Galaxy'),('Ford','Mustang Mach-E'),('Ford','Explorer'),
  ('Ford','Tourneo Connect'),('Ford','Tourneo Custom'),
  -- ─── Opel ───
  ('Opel','Corsa'),('Opel','Astra'),('Opel','Astra Sports Tourer'),('Opel','Insignia'),
  ('Opel','Mokka'),('Opel','Crossland'),('Opel','Grandland'),('Opel','Combo Life'),
  ('Opel','Zafira Life'),
  -- ─── Nissan ───
  ('Nissan','Micra'),('Nissan','Leaf'),('Nissan','Qashqai'),('Nissan','X-Trail'),('Nissan','Juke'),
  ('Nissan','Ariya'),('Nissan','Pulsar'),
  -- ─── Fiat ───
  ('Fiat','Tipo'),('Fiat','Tipo SW'),('Fiat','500X'),('Fiat','500L'),('Fiat','Doblo'),
  ('Fiat','Ulysse'),
  -- ─── Mazda ───
  ('Mazda','Mazda2'),('Mazda','Mazda3'),('Mazda','Mazda6'),('Mazda','CX-3'),('Mazda','CX-30'),
  ('Mazda','CX-5'),('Mazda','CX-60'),('Mazda','MX-30'),
  -- ─── Honda ───
  ('Honda','Civic'),('Honda','Accord'),('Honda','Jazz'),('Honda','HR-V'),('Honda','CR-V'),
  ('Honda','e:Ny1'),
  -- ─── Mitsubishi / Suzuki ───
  ('Mitsubishi','Space Star'),('Mitsubishi','ASX'),('Mitsubishi','Eclipse Cross'),
  ('Mitsubishi','Outlander'),
  ('Suzuki','Swift'),('Suzuki','Baleno'),('Suzuki','SX4 S-Cross'),('Suzuki','Vitara'),
  ('Suzuki','Across'),
  -- ─── Mini / Alfa Romeo ───
  ('Mini','Clubman'),('Mini','Countryman'),
  ('Alfa Romeo','Giulia'),('Alfa Romeo','Stelvio'),('Alfa Romeo','Tonale'),('Alfa Romeo','Giulietta'),
  -- ─── Jaguar / Land Rover ───
  ('Jaguar','XE'),('Jaguar','XF'),('Jaguar','I-Pace'),('Jaguar','E-Pace'),('Jaguar','F-Pace'),
  ('Land Rover','Range Rover'),('Land Rover','Range Rover Sport'),('Land Rover','Range Rover Evoque'),
  ('Land Rover','Range Rover Velar'),('Land Rover','Discovery'),('Land Rover','Discovery Sport'),
  ('Land Rover','Defender'),
  -- ─── Lexus ───
  ('Lexus','IS'),('Lexus','ES'),('Lexus','LS'),('Lexus','UX'),('Lexus','NX'),('Lexus','RX'),
  ('Lexus','RZ'),
  -- ─── Polestar / BYD / MG ───
  ('Polestar','2'),('Polestar','3'),('Polestar','4'),
  ('BYD','Atto 3'),('BYD','Dolphin'),('BYD','Seal'),('BYD','Han'),('BYD','Tang'),('BYD','Seal U'),
  ('MG','MG4'),('MG','MG5'),('MG','ZS'),('MG','HS'),('MG','Marvel R'),('MG','MG3'),
  -- ─── Genesis / Subaru / Jeep ───
  ('Genesis','G70'),('Genesis','G80'),('Genesis','GV60'),('Genesis','GV70'),('Genesis','GV80'),
  ('Subaru','Impreza'),('Subaru','Outback'),('Subaru','XV'),('Subaru','Forester'),('Subaru','Solterra'),
  ('Jeep','Renegade'),('Jeep','Compass'),('Jeep','Cherokee'),('Jeep','Grand Cherokee'),
  ('Jeep','Avenger'),
  -- ─── Premium / limousine ───
  ('Porsche','Panamera'),('Porsche','Cayenne'),('Porsche','Macan'),('Porsche','Taycan'),
  ('Maserati','Ghibli'),('Maserati','Quattroporte'),('Maserati','Levante'),('Maserati','Grecale'),
  -- ─── Smart (nouveaux SUV électriques) ───
  ('Smart','#1'),('Smart','#3')
) as v(make, model)
where not exists (
  select 1 from public.vehicles_db e
  where e.make = v.make and e.model = v.model
);
