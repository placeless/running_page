## Spanish province boundaries

`spain-provinces.json` contains 52 Spanish ADM2 provinces from **geoBoundaries**
(William & Mary geoLab), source **Instituto Nacional de Estadística (INE)**,
boundary reference year **2018**. Downloaded from the `gbOpen` release at commit
`9469f09` (`ESP/ADM2/geoBoundaries-ESP-ADM2_simplified.geojson`). Coordinates
were simplified further with a 0.001-degree Douglas–Peucker tolerance and
rounded to five decimal places to reduce the repository footprint; no
administrative names were altered.

Metadata and attribution: https://www.geoboundaries.org/api/current/gbOpen/ESP/ADM2/

geoBoundaries `gbOpen` requires attribution and is distributed under CC BY 4.0.
See the original source for the underlying INE licensing information.

The data is used **at export time** only; it is not included in the frontend
JavaScript bundle. Boundaries are approximate, especially within approximately
100 m of provincial borders; routes outside the supported boundaries retain
unknown province metadata rather than receiving a guessed assignment.
